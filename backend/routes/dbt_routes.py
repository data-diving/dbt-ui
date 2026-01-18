"""dbt command API routes."""
from fastapi import APIRouter, HTTPException, BackgroundTasks, Request
from pydantic import BaseModel
from pathlib import Path
from typing import Dict, Optional
from datetime import datetime
import subprocess
import json as json_module
import re
import os

from models import ProjectPath, DbtLsRequest, DbtShowRequest, DbtCommandRequest
from utils.dbt_utils import get_dbt_env, parse_dbt_manifest, get_node_from_manifest, extract_model_metadata
from utils.venv_utils import get_venv_dbt_path
from utils.operation_lock import acquire_lock, release_lock, is_locked, get_lock_status
from routes.env_routes import get_env_vars_from_cookie
from utils.input_validation import validate_dbt_selector, validate_dbt_target
from utils.subprocess_utils import run_command

router = APIRouter()

# Global dbt command status tracker (for all background dbt operations)
dbt_command_status: Dict[str, Dict[str, any]] = {}

# Valid dbt commands for the unified endpoint
VALID_DBT_COMMANDS = {"compile", "run", "test", "seed"}


@router.post("/api/dbt-command-status")
async def get_dbt_command_status(project_path: ProjectPath):
    """Get the status of a background dbt command job."""
    path = Path(project_path.path).expanduser().resolve()
    path_str = str(path)

    if path_str not in dbt_command_status:
        return {"status": "not_started"}

    return dbt_command_status[path_str]


# Keep old endpoint for backward compatibility
@router.post("/api/compilation-status")
async def get_compilation_status(project_path: ProjectPath):
    """Get the status of a compilation job. (Deprecated: use /api/dbt-command-status)"""
    return await get_dbt_command_status(project_path)


@router.post("/api/dbt-operation-status")
async def get_dbt_operation_status(project_path: ProjectPath):
    """Get the current dbt operation status for a specific worktree (for disabling buttons in UI).

    Also returns last completion info so other users can detect when operations
    finish and refresh their state accordingly.
    """
    path = Path(project_path.path).expanduser().resolve()
    path_str = str(path)

    status = get_lock_status(path_str)

    return {
        "is_running": status["is_locked"],
        "operation": status["operation"],
        "last_completed_operation": status.get("last_completed_operation"),
        "last_completion_id": status.get("last_completion_id"),
    }


def run_dbt_command_task(path: Path, command: str, selector: str = "", target: str = "", full_refresh: bool = False, env_vars: dict = None):
    """Background task to run any dbt command and update dbt_command_status."""
    path_str = str(path)

    try:
        dbt_command_status[path_str] = {
            "status": "running",
            "command": command,
            "selector": selector,
            "started_at": datetime.now().isoformat()
        }

        # Get dbt executable for this project (venv or global)
        try:
            dbt_executable = str(get_venv_dbt_path(path))
        except FileNotFoundError:
            dbt_executable = "dbt"

        # Build command
        cmd = [dbt_executable, command, "--project-dir", str(path), "--profiles-dir", str(path)]
        if selector:
            cmd.extend(["--select", selector])
        if target:
            cmd.extend(["--target", target])
        if full_refresh and command in ("run", "seed"):
            cmd.append("--full-refresh")

        # Get environment with env vars from frontend
        env = get_dbt_env(path, env_vars)

        result = run_command(cmd, path, timeout=300, env=env)

        if result.success:
            dbt_command_status[path_str] = {
                "status": "success",
                "command": command,
                "selector": selector,
                "completed_at": datetime.now().isoformat(),
                "output": result.stdout
            }
        else:
            dbt_command_status[path_str] = {
                "status": "failed",
                "command": command,
                "selector": selector,
                "completed_at": datetime.now().isoformat(),
                "error": result.error
            }
    except subprocess.TimeoutExpired:
        dbt_command_status[path_str] = {
            "status": "failed",
            "command": command,
            "selector": selector,
            "completed_at": datetime.now().isoformat(),
            "error": f"dbt {command} timed out after 5 minutes"
        }
    except Exception as e:
        dbt_command_status[path_str] = {
            "status": "failed",
            "command": command,
            "selector": selector,
            "completed_at": datetime.now().isoformat(),
            "error": str(e)
        }
    finally:
        release_lock(path_str)


@router.post("/api/dbt-command")
async def dbt_command(action: DbtCommandRequest, background_tasks: BackgroundTasks, request: Request):
    """Unified endpoint to run any dbt command (compile, run, test, seed) in background."""
    path = Path(action.path).expanduser().resolve()

    if not path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    # Validate command
    command = action.command.lower().strip()
    if command not in VALID_DBT_COMMANDS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid command: {command}. Must be one of: {', '.join(VALID_DBT_COMMANDS)}"
        )

    # Validate selector and target for security
    selector = validate_dbt_selector(action.selector, "selector")
    target = validate_dbt_target(action.target)

    path_str = str(path)

    # Check if another operation is running for this worktree
    status = get_lock_status(path_str)
    if status["is_locked"]:
        raise HTTPException(
            status_code=409,
            detail=f"Another operation is already running: {status['operation']}"
        )

    # Build operation name based on command type
    full_refresh_suffix = " (full refresh)" if action.full_refresh and command in ("run", "seed") else ""
    if command == "compile":
        operation_name = f"Compiling: {selector}" if selector else "Compiling entire project"
    elif command == "run":
        operation_name = (f"Running: {selector}" if selector else "Running all models") + full_refresh_suffix
    elif command == "test":
        operation_name = f"Testing: {selector}" if selector else "Testing all models"
    elif command == "seed":
        operation_name = (f"Seeding: {selector}" if selector else "Seeding all seeds") + full_refresh_suffix
    else:
        operation_name = f"dbt {command}: {selector}" if selector else f"dbt {command}"

    # Try to acquire lock for this worktree
    if not acquire_lock(path_str, operation_name):
        raise HTTPException(
            status_code=409,
            detail=f"Another operation is already running: {get_lock_status(path_str)['operation']}"
        )

    # Get env vars from HttpOnly cookie (automatically sent with request)
    env_vars = get_env_vars_from_cookie(request, str(path))

    # Always run in background
    background_tasks.add_task(run_dbt_command_task, path, command, selector, target, action.full_refresh, env_vars)

    return {
        "status": "started",
        "command": command,
        "selector": selector,
        "message": operation_name
    }


# Keep old compile endpoint for backward compatibility
@router.post("/api/dbt-compile-model")
async def dbt_compile_model(action: DbtCommandRequest, background_tasks: BackgroundTasks, request: Request):
    """Compile dbt model(s) using project's venv dbt. (Deprecated: use /api/dbt-command)"""
    action.command = "compile"
    return await dbt_command(action, background_tasks, request)


# Keep old run endpoint for backward compatibility - now runs in background
@router.post("/api/dbt-run-model")
async def dbt_run_model(action: DbtCommandRequest, background_tasks: BackgroundTasks, request: Request):
    """Run dbt model(s). (Deprecated: use /api/dbt-command)"""
    action.command = "run"
    return await dbt_command(action, background_tasks, request)


# Keep old seed endpoint for backward compatibility - now runs in background
@router.post("/api/dbt-seed")
async def dbt_seed(action: DbtCommandRequest, background_tasks: BackgroundTasks, request: Request):
    """Run dbt seed. (Deprecated: use /api/dbt-command)"""
    action.command = "seed"
    return await dbt_command(action, background_tasks, request)


# Keep old test endpoint for backward compatibility - now runs in background
@router.post("/api/dbt-test-model")
async def dbt_test_model(action: DbtCommandRequest, background_tasks: BackgroundTasks, request: Request):
    """Test dbt model(s). (Deprecated: use /api/dbt-command)"""
    action.command = "test"
    return await dbt_command(action, background_tasks, request)


@router.post("/api/dbt-ls")
async def dbt_ls(ls_request: DbtLsRequest):
    """Run dbt ls to get list of models matching a selector."""
    path = Path(ls_request.path).expanduser().resolve()

    if not path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    # Validate selector for security
    selector = validate_dbt_selector(ls_request.selector, "selector")

    try:
        # Get dbt executable for this project (venv or global)
        try:
            dbt_executable = str(get_venv_dbt_path(path))
        except FileNotFoundError:
            dbt_executable = "dbt"

        # Build command
        cmd = [dbt_executable, "ls", "--resource-type", "model"]
        if selector:
            cmd.extend(["--select", selector])
        cmd.extend(["--project-dir", str(path), "--profiles-dir", str(path)])

        print(f"[dbt-ls] Running: {' '.join(cmd)}")

        # Get environment with dbt-ui env vars loaded
        env = get_dbt_env(path)

        result = run_command(cmd, path, timeout=30, env=env)

        if result.success:
            # Parse output - each line is a model name (e.g., "my_project.model_name")
            models = []
            for line in result.stdout.strip().split('\n'):
                line = line.strip()
                if line and not line.startswith('['):  # Skip log lines
                    # Extract just the model name (after the last dot)
                    model_name = line.split('.')[-1] if '.' in line else line
                    models.append(model_name)

            return {
                "success": True,
                "models": models
            }
        else:
            print(f"[dbt-ls] Failed: {result.stderr}")
            return {
                "success": False,
                "models": [],
                "error": result.stderr
            }
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "models": [],
            "error": "dbt ls timed out"
        }
    except Exception as e:
        print(f"[dbt-ls] Error: {str(e)}")
        return {
            "success": False,
            "models": [],
            "error": str(e)
        }


@router.post("/api/dbt-show-model")
async def dbt_show_model(show_request: DbtShowRequest, http_request: Request):
    """Run dbt show to preview model data using inline SQL query."""
    path = Path(show_request.path).expanduser().resolve()

    if not path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    # Validate model name for security
    model = validate_dbt_selector(show_request.model, "model")

    # Validate limit (already an int from Pydantic, but ensure reasonable bounds)
    limit = min(max(1, show_request.limit), 1000)

    try:
        # Get dbt executable for this project (venv or global)
        try:
            dbt_executable = str(get_venv_dbt_path(path))
        except FileNotFoundError:
            dbt_executable = "dbt"

        # Get schema from manifest for the model
        manifest = parse_dbt_manifest(path)
        if not manifest:
            return {
                "success": False,
                "error": "manifest.json not found. Please compile the project first.",
                "columns": [],
                "rows": []
            }

        node = get_node_from_manifest(manifest, model, 'model')
        if not node:
            return {
                "success": False,
                "error": f"Model '{model}' not found in manifest. Please compile the project.",
                "columns": [],
                "rows": []
            }

        # Build the fully qualified table name (schema.table or database.schema.table)
        schema = node.get('schema', '')
        # Use alias if set, otherwise model name
        table_name = node.get('alias') or model

        if not schema:
            return {
                "success": False,
                "error": f"Could not determine schema for model '{model}'",
                "columns": [],
                "rows": []
            }

        # Build inline SQL query
        qualified_name = f"{schema}.{table_name}"
        inline_sql = f"select * from {qualified_name}"

        # Run dbt show with inline query and JSON output
        cmd = [
            dbt_executable, "show",
            "--inline", inline_sql,
            "--limit", str(limit),
            "--output", "json",
            "--project-dir", str(path),
            "--profiles-dir", str(path)
        ]

        print(f"[dbt-show-model] Running: {' '.join(cmd)}")

        # Get environment with env vars from HttpOnly cookie
        env_vars = get_env_vars_from_cookie(http_request, str(path))
        env = get_dbt_env(path, env_vars)

        result = run_command(cmd, path, timeout=120, env=env)

        print(f"[dbt-show-model] Return code: {result.returncode}")
        print(f"[dbt-show-model] Stdout: {result.stdout[:500] if result.stdout else 'empty'}")
        print(f"[dbt-show-model] Stderr: {result.stderr[:500] if result.stderr else 'empty'}")

        if not result.success:
            error_msg = result.error or "Unknown error"
            return {
                "success": False,
                "error": error_msg,
                "columns": [],
                "rows": []
            }

        # Parse JSON output from dbt show
        stdout = result.stdout.strip()
        if not stdout:
            return {
                "success": True,
                "columns": [],
                "rows": [],
                "message": "No data returned"
            }

        columns = []
        rows = []

        print(f"[dbt-show-model] Full stdout:\n{stdout}")

        # dbt 1.9+ outputs JSON as a multi-line pretty-printed object
        # Find JSON by looking for lines that start with '{' and extracting the complete JSON block

        # Try to find a JSON object in the output (multi-line)
        # Look for JSON that starts with { and ends with }
        json_match = re.search(r'\{[\s\S]*\}', stdout)
        if json_match:
            json_str = json_match.group()
            print(f"[dbt-show-model] Found JSON block of length {len(json_str)}")
            try:
                data = json_module.loads(json_str)
                print(f"[dbt-show-model] Parsed JSON keys: {data.keys() if isinstance(data, dict) else 'not a dict'}")
                if isinstance(data, dict):
                    # dbt 1.9+ format: {"node": "model_name", "show": [{...}, {...}]}
                    if 'show' in data and isinstance(data['show'], list):
                        show_data = data['show']
                        print(f"[dbt-show-model] Found 'show' key with {len(show_data) if show_data else 0} rows")
                        if show_data and len(show_data) > 0:
                            columns = list(show_data[0].keys())
                            rows = show_data
                    # Alternative format: {"data": {"preview": [rows...]}}
                    elif 'data' in data and isinstance(data['data'], dict) and 'preview' in data['data']:
                        preview = data['data']['preview']
                        print(f"[dbt-show-model] Found data.preview with {len(preview) if preview else 0} rows")
                        if preview and len(preview) > 0:
                            columns = list(preview[0].keys())
                            rows = preview
                    # Alternative format: {"preview": [rows...]}
                    elif 'preview' in data:
                        preview = data['preview']
                        print(f"[dbt-show-model] Found preview with {len(preview) if preview else 0} rows")
                        if preview and len(preview) > 0:
                            columns = list(preview[0].keys())
                            rows = preview
                    # Legacy format: {"results": [{"agate_table": {"rows": [...], "column_names": [...]}}]}
                    elif 'results' in data and isinstance(data['results'], list):
                        for res in data['results']:
                            if isinstance(res, dict) and 'agate_table' in res:
                                agate = res['agate_table']
                                if 'column_names' in agate and 'rows' in agate:
                                    columns = agate['column_names']
                                    rows = [dict(zip(columns, row)) for row in agate['rows']]
                                    print(f"[dbt-show-model] Found agate_table with {len(rows)} rows")
                                    break
            except json_module.JSONDecodeError as e:
                print(f"[dbt-show-model] JSON decode error: {e}")

        # If we couldn't parse JSON output, try to parse the text output
        if not rows and result.stdout:
            print(f"[dbt-show-model] Trying to parse as text table output")
            # dbt show without --output json shows a table, try to parse it
            lines = result.stdout.strip().split('\n')
            # Find the header line (usually has | separators)
            for i, line in enumerate(lines):
                if '|' in line and not line.startswith('--'):
                    parts = [p.strip() for p in line.split('|') if p.strip()]
                    if not columns:
                        columns = parts
                    else:
                        if len(parts) == len(columns):
                            row = {columns[j]: parts[j] for j in range(len(columns))}
                            rows.append(row)

        print(f"[dbt-show-model] Final result: {len(columns)} columns, {len(rows)} rows")

        return {
            "success": True,
            "columns": columns,
            "rows": rows
        }

    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": "Query timed out after 2 minutes",
            "columns": [],
            "rows": []
        }
    except Exception as e:
        print(f"[dbt-show-model] Exception: {e}")
        return {
            "success": False,
            "error": str(e),
            "columns": [],
            "rows": []
        }


@router.post("/api/get-lineage")
async def get_lineage(project_path: ProjectPath):
    """Extract lineage information from dbt manifest.json."""
    path = Path(project_path.path).expanduser().resolve()

    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=404, detail="Project path not found")

    # Try to load manifest.json
    manifest = parse_dbt_manifest(path)

    if not manifest:
        raise HTTPException(
            status_code=404,
            detail="manifest.json not found. Please run 'dbt parse' or 'dbt compile' first."
        )

    nodes = []

    # Extract nodes from manifest
    if 'nodes' in manifest:
        for node_id, node_data in manifest['nodes'].items():
            resource_type = node_data.get('resource_type')

            # Only include models, seeds, and tests
            if resource_type in ['model', 'seed', 'test']:
                # Extract dependencies
                dependencies = []
                if 'depends_on' in node_data and 'nodes' in node_data['depends_on']:
                    for dep_id in node_data['depends_on']['nodes']:
                        # Extract the name from the node ID (e.g., "model.my_project.customers" -> "customers")
                        dep_name = dep_id.split('.')[-1]
                        dependencies.append(dep_name)

                # Get file path relative to project
                file_path = node_data.get('original_file_path', '')

                nodes.append({
                    "name": node_data.get('name'),
                    "type": resource_type,
                    "dependencies": dependencies,
                    "filePath": file_path
                })

    # Extract sources from manifest
    if 'sources' in manifest:
        for source_id, source_data in manifest['sources'].items():
            source_name = f"{source_data.get('source_name')}_{source_data.get('name')}"

            # Get file path for the source definition
            file_path = source_data.get('original_file_path', '')

            nodes.append({
                "name": source_name,
                "type": "source",
                "dependencies": [],
                "filePath": file_path
            })

    return {"nodes": nodes}


@router.post("/api/get-metadata")
async def get_metadata(file_data: dict):
    """Get metadata for a file using dbt's manifest.json."""
    project_path = Path(file_data['projectPath']).expanduser().resolve()
    file_path = file_data['filePath']

    if not project_path.exists():
        raise HTTPException(status_code=404, detail="Project path not found")

    # Extract file name and determine type
    file_name = Path(file_path).stem
    file_ext = Path(file_path).suffix

    # Determine object type
    obj_type = 'unknown'
    if 'models' in file_path and file_ext == '.sql':
        obj_type = 'model'
    elif 'seeds' in file_path and file_ext == '.csv':
        obj_type = 'seed'
    elif 'macros' in file_path and file_ext == '.sql':
        obj_type = 'macro'
    elif 'source' in file_path or 'schema' in file_path:
        obj_type = 'source'

    # Try to get metadata from dbt manifest
    manifest = parse_dbt_manifest(project_path)

    # Extract metadata from manifest if available
    if manifest:
        node_data = get_node_from_manifest(manifest, file_name, obj_type)
        if node_data:
            return extract_model_metadata(node_data)

    # Fall back to basic metadata if manifest not available
    return {
        'name': file_name,
        'type': obj_type,
        'description': '',
        'note': 'Click the compile button in the sidebar to generate metadata.'
    }


@router.post("/api/get-compiled-sql")
async def get_compiled_sql(file_data: dict):
    """Get compiled SQL for a model from target/compiled directory."""
    project_path = Path(file_data['projectPath']).expanduser().resolve()
    file_path = file_data['filePath']

    if not project_path.exists():
        raise HTTPException(status_code=404, detail="Project path not found")

    # Extract file name
    file_name = Path(file_path).stem

    # Load manifest to get project name and model path
    manifest = parse_dbt_manifest(project_path)

    if not manifest:
        raise HTTPException(
            status_code=404,
            detail="manifest.json not found. Please compile the project first."
        )

    # Get project name from manifest metadata
    project_name = manifest.get('metadata', {}).get('project_name', '')

    # Find the model in manifest to get its compiled path
    if 'nodes' in manifest:
        for node_id, node_data in manifest['nodes'].items():
            if node_data.get('name') == file_name and node_data.get('resource_type') == 'model':
                # Try to get compiled SQL from manifest first (if available after full dbt compile)
                compiled_sql = node_data.get('compiled_code') or node_data.get('compiled_sql', '')
                if compiled_sql:
                    return {
                        "success": True,
                        "compiled_sql": compiled_sql
                    }

                # Otherwise, read from the compiled file in target/compiled
                # Get the relative path from the node (e.g., "marts/customer_orders.sql")
                model_path = node_data.get('path', '')
                compiled_file_path = project_path / 'target' / 'compiled' / project_name / 'models' / model_path

                if compiled_file_path.exists():
                    try:
                        with open(compiled_file_path, 'r', encoding='utf-8') as f:
                            compiled_sql = f.read()
                        return {
                            "success": True,
                            "compiled_sql": compiled_sql
                        }
                    except Exception as e:
                        raise HTTPException(
                            status_code=500,
                            detail=f"Error reading compiled SQL file: {str(e)}"
                        )
                else:
                    raise HTTPException(
                        status_code=404,
                        detail="Compiled SQL file not found. Please compile the project first."
                    )

    raise HTTPException(
        status_code=404,
        detail=f"Model {file_name} not found in manifest."
    )


@router.post("/api/get-profile-targets")
async def get_profile_targets(project_path: ProjectPath):
    """Get available targets from profiles.yml for the project."""
    import yaml

    path = Path(project_path.path).expanduser().resolve()

    if not path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    # First get profile name from dbt_project.yml
    dbt_project_file = path / "dbt_project.yml"
    if not dbt_project_file.exists():
        raise HTTPException(status_code=404, detail="dbt_project.yml not found")

    try:
        with open(dbt_project_file, 'r', encoding='utf-8') as f:
            dbt_project = yaml.safe_load(f)

        profile_name = dbt_project.get('profile', dbt_project.get('name'))

        if not profile_name:
            return {
                "targets": [],
                "default_target": None,
                "profile_name": None,
                "error": "No profile name found in dbt_project.yml"
            }

        # Look for profiles.yml in project directory first, then in ~/.dbt/
        profiles_file = path / "profiles.yml"
        if not profiles_file.exists():
            dbt_dir = Path.home() / ".dbt"
            profiles_file = dbt_dir / "profiles.yml"

        if not profiles_file.exists():
            return {
                "targets": [],
                "default_target": None,
                "profile_name": profile_name,
                "error": "profiles.yml not found"
            }

        with open(profiles_file, 'r', encoding='utf-8') as f:
            profiles = yaml.safe_load(f)

        # Try to find the profile: first by profile_name from dbt_project.yml, then fallback to "default"
        actual_profile_name = None
        if profile_name in profiles:
            actual_profile_name = profile_name
        elif 'default' in profiles:
            actual_profile_name = 'default'

        if not actual_profile_name:
            return {
                "targets": [],
                "default_target": None,
                "profile_name": profile_name,
                "error": f"Profile '{profile_name}' not found in profiles.yml (also tried 'default')"
            }

        profile = profiles[actual_profile_name]
        outputs = profile.get('outputs', {})
        default_target = profile.get('target', 'dev')

        targets = list(outputs.keys())

        return {
            "targets": targets,
            "default_target": default_target,
            "profile_name": actual_profile_name,
            "error": None
        }

    except Exception as e:
        return {
            "targets": [],
            "default_target": None,
            "profile_name": None,
            "error": str(e)
        }


class GetTargetDetailsRequest(BaseModel):
    """Request model for getting target details."""
    path: str
    target: Optional[str] = None


@router.post("/api/get-target-details")
async def get_target_details(request: GetTargetDetailsRequest):
    """Get database and schema details for a specific target from profiles.yml."""
    import yaml

    path = Path(request.path).expanduser().resolve()

    if not path.exists():
        return {"success": False, "error": "Project path does not exist", "database": None, "schema": None}

    # First get profile name from dbt_project.yml
    dbt_project_file = path / "dbt_project.yml"
    if not dbt_project_file.exists():
        return {"success": False, "error": "dbt_project.yml not found", "database": None, "schema": None}

    try:
        with open(dbt_project_file, 'r', encoding='utf-8') as f:
            dbt_project = yaml.safe_load(f)

        profile_name = dbt_project.get('profile', dbt_project.get('name'))

        if not profile_name:
            return {"success": False, "error": "No profile name found in dbt_project.yml", "database": None, "schema": None}

        # Look for profiles.yml in project directory first, then in ~/.dbt/
        profiles_file = path / "profiles.yml"
        if not profiles_file.exists():
            dbt_dir = Path.home() / ".dbt"
            profiles_file = dbt_dir / "profiles.yml"

        if not profiles_file.exists():
            return {"success": False, "error": "profiles.yml not found", "database": None, "schema": None}

        with open(profiles_file, 'r', encoding='utf-8') as f:
            profiles = yaml.safe_load(f)

        # Try to find the profile: first by profile_name from dbt_project.yml, then fallback to "default"
        actual_profile_name = None
        if profile_name in profiles:
            actual_profile_name = profile_name
        elif 'default' in profiles:
            actual_profile_name = 'default'

        if not actual_profile_name:
            return {"success": False, "error": f"Profile '{profile_name}' not found in profiles.yml (also tried 'default')", "database": None, "schema": None}

        profile = profiles[actual_profile_name]
        outputs = profile.get('outputs', {})
        default_target = profile.get('target', 'dev')

        # Use specified target or default
        target_name = request.target or default_target

        if target_name not in outputs:
            return {"success": False, "error": f"Target '{target_name}' not found in profile", "database": None, "schema": None}

        target_config = outputs[target_name]

        return {
            "success": True,
            "error": None,
            "target": target_name,
            "database": target_config.get('database') or target_config.get('dbname'),
            "schema": target_config.get('schema')
        }

    except Exception as e:
        return {"success": False, "error": str(e), "database": None, "schema": None}
