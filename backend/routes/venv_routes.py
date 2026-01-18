"""Virtual environment management API routes."""
from fastapi import APIRouter, HTTPException
from pathlib import Path
from typing import Dict
import subprocess
import asyncio
import shutil
import yaml
import re

from models import ProjectPath
from utils.venv_utils import (
    get_venv_path, ensure_venv_exists,
    get_venv_python_path, get_venv_dbt_path
)
from utils.dbt_utils import get_dbt_env
from utils.operation_lock import acquire_lock, release_lock, get_lock_status
from utils.subprocess_utils import run_command

router = APIRouter()


def _recreate_venv_sync(project_path: ProjectPath):
    """Synchronous helper for recreating venv - runs in thread pool."""
    # Collect output logs
    output_lines = []

    path = Path(project_path.path).expanduser().resolve()

    if not path.exists():
        raise HTTPException(status_code=404, detail={
            "message": "Project path does not exist",
            "output": "\n".join(output_lines)
        })

    dbt_project_file = path / "dbt_project.yml"
    if not dbt_project_file.exists():
        output_lines.append("Error: dbt_project.yml not found")
        raise HTTPException(status_code=400, detail={
            "message": "Not a valid dbt project (dbt_project.yml not found)",
            "output": "\n".join(output_lines)
        })

    # Delete existing venv if it exists
    venv_path = get_venv_path(path)
    if venv_path.exists():
        output_lines.append(f"Deleting existing venv at {venv_path}")
        print(f"[recreate-venv] Deleting existing venv at {venv_path}")
        shutil.rmtree(venv_path)
        output_lines.append("Deleted existing venv")
        print(f"[recreate-venv] Deleted existing venv")

    # Now recreate the venv and install dependencies
    output_lines.append("Creating new virtual environment...")
    print(f"[recreate-venv] Recreating venv and installing dependencies")

    # Ensure virtual environment exists for this project
    print(f"[recreate-venv] Ensuring virtual environment exists for {path}")
    if not ensure_venv_exists(path):
        output_lines.append("Error: Failed to create virtual environment")
        raise HTTPException(
            status_code=500,
            detail={
                "message": "Failed to create virtual environment for project",
                "output": "\n".join(output_lines)
            }
        )

    # Get path to the venv's Python executable
    try:
        venv_python = get_venv_python_path(path)
        output_lines.append(f"Using Python: {venv_python}")
        print(f"[recreate-venv] Using Python: {venv_python}")
    except FileNotFoundError as e:
        output_lines.append(f"Error: {str(e)}")
        raise HTTPException(status_code=500, detail={
            "message": str(e),
            "output": "\n".join(output_lines)
        })

    # Check for requirements.txt and install dependencies if it exists
    requirements_file = path / "requirements.txt"
    if requirements_file.exists():
        output_lines.append("Installing requirements.txt dependencies...")
        print(f"[recreate-venv] Found requirements.txt, installing Python dependencies")
        try:
            result = run_command(
                ["uv", "pip", "install", "-r", str(requirements_file), "--python", str(venv_python), "--upgrade"],
                path,
                timeout=300
            )

            if not result.success:
                output_lines.append(f"Warning: Failed to install requirements.txt: {result.stderr}")
                print(f"Warning: Failed to install requirements.txt dependencies: {result.stderr}")
            else:
                output_lines.append("Successfully installed requirements.txt dependencies")
                if result.stdout:
                    output_lines.append(result.stdout)
                print(f"Successfully installed requirements.txt dependencies")
        except subprocess.TimeoutExpired:
            output_lines.append("Warning: requirements.txt installation timed out")
            print(f"Warning: requirements.txt installation timed out")
        except Exception as e:
            output_lines.append(f"Warning: Error installing requirements.txt: {str(e)}")
            print(f"Warning: Error installing requirements.txt: {str(e)}")

    # Read dbt_project.yml to get the dbt version requirement
    with open(dbt_project_file, 'r') as f:
        dbt_config = yaml.safe_load(f)

    require_dbt_version = dbt_config.get('require-dbt-version')

    # Determine which dbt version to install
    dbt_core_spec = "dbt-core"
    if require_dbt_version:
        if isinstance(require_dbt_version, list):
            version_spec = require_dbt_version[0]
        else:
            version_spec = require_dbt_version

        version_spec = version_spec.strip()

        if version_spec.startswith('>='):
            version = version_spec[2:].strip()
            dbt_core_spec = f"dbt-core>={version}"
        elif version_spec.startswith('='):
            version = version_spec[1:].strip()
            dbt_core_spec = f"dbt-core=={version}"
        elif version_spec.startswith('<'):
            version = version_spec[1:].strip()
            dbt_core_spec = f"dbt-core<{version}"
        else:
            try:
                float(version_spec.replace('.', '', 1))
                dbt_core_spec = f"dbt-core=={version_spec}"
            except ValueError:
                dbt_core_spec = f"dbt-core{version_spec}"

    output_lines.append(f"Installing {dbt_core_spec}...")
    print(f"[recreate-venv] Installing dbt-core with spec: {dbt_core_spec}")

    # Install dbt-core
    result = run_command(
        ["uv", "pip", "install", dbt_core_spec, "--python", str(venv_python)],
        path,
        timeout=300
    )

    if not result.success:
        output_lines.append(f"Error: Failed to install dbt-core: {result.stderr}")
        raise HTTPException(
            status_code=500,
            detail={
                "message": f"Failed to install dbt-core: {result.stderr}",
                "output": "\n".join(output_lines)
            }
        )

    output_lines.append(f"Successfully installed {dbt_core_spec}")
    if result.stdout:
        output_lines.append(result.stdout)

    # Get installed dbt version
    version_result = run_command(
        [str(venv_python), "-c", "import dbt.version; print(dbt.version.get_installed_version())"],
        path
    )

    dbt_version = version_result.stdout.strip() if version_result.success else "unknown"
    output_lines.append(f"\nInstalled dbt version: {dbt_version}")

    # Run dbt deps to install dbt packages (e.g., dbt_utils)
    # Check for packages.yml or dependencies.yml
    deps_packages_file = path / "packages.yml"
    if not deps_packages_file.exists():
        deps_packages_file = path / "dependencies.yml"

    if deps_packages_file.exists():
        output_lines.append(f"\nRunning dbt deps to install packages from {deps_packages_file.name}...")
        print(f"[recreate-venv] Running dbt deps from {deps_packages_file.name}")

        try:
            dbt_executable = get_venv_dbt_path(path)

            # Get environment with dbt-ui env vars loaded (if any exist)
            env = get_dbt_env(path)

            deps_result = run_command(
                [str(dbt_executable), "deps", "--project-dir", str(path), "--profiles-dir", str(path)],
                path,
                timeout=300,
                env=env
            )

            if not deps_result.success:
                error_output = deps_result.error or "Unknown error"
                output_lines.append(f"Error: dbt deps failed:\n{error_output}")
                output_lines.append("\nRemoving incomplete virtual environment...")
                print(f"[recreate-venv] Error: dbt deps failed: {error_output}")
                # Delete the venv so it's properly detected as missing
                if venv_path.exists():
                    shutil.rmtree(venv_path)
                    print(f"[recreate-venv] Deleted incomplete venv at {venv_path}")
                raise HTTPException(
                    status_code=500,
                    detail={
                        "message": "dbt deps failed. Please check your packages.yml file.",
                        "output": "\n".join(output_lines)
                    }
                )
            else:
                output_lines.append("Successfully ran dbt deps")
                if deps_result.stdout:
                    output_lines.append(deps_result.stdout)
                print(f"[recreate-venv] dbt deps completed successfully")
        except HTTPException:
            raise
        except FileNotFoundError:
            output_lines.append("Warning: dbt executable not found in venv, skipping dbt deps")
            print(f"[recreate-venv] Warning: dbt executable not found in venv, skipping dbt deps")
        except subprocess.TimeoutExpired:
            output_lines.append("Error: dbt deps timed out after 5 minutes")
            output_lines.append("\nRemoving incomplete virtual environment...")
            print(f"[recreate-venv] Error: dbt deps timed out")
            # Delete the venv so it's properly detected as missing
            if venv_path.exists():
                shutil.rmtree(venv_path)
                print(f"[recreate-venv] Deleted incomplete venv at {venv_path}")
            raise HTTPException(
                status_code=500,
                detail={
                    "message": "dbt deps timed out. Please check your network connection.",
                    "output": "\n".join(output_lines)
                }
            )
        except Exception as e:
            output_lines.append(f"Error running dbt deps: {str(e)}")
            output_lines.append("\nRemoving incomplete virtual environment...")
            print(f"[recreate-venv] Error running dbt deps: {str(e)}")
            # Delete the venv so it's properly detected as missing
            if venv_path.exists():
                shutil.rmtree(venv_path)
                print(f"[recreate-venv] Deleted incomplete venv at {venv_path}")
            raise HTTPException(
                status_code=500,
                detail={
                    "message": f"Error running dbt deps: {str(e)}",
                    "output": "\n".join(output_lines)
                }
            )

    # Load environment variables from .dbt-ui-env file if it exists
    env_file = path / ".dbt-ui-env"
    if env_file.exists():
        output_lines.append("\nLoading environment variables from .dbt-ui-env...")
        print(f"[recreate-venv] Loading env vars from .dbt-ui-env")

        try:
            env_vars_to_set: Dict[str, str] = {}
            with open(env_file, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and '=' in line and not line.startswith('#'):
                        var_name, var_value = line.split('=', 1)
                        if re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', var_name):
                            env_vars_to_set[var_name] = var_value

            if env_vars_to_set:
                # Add env vars to activate script
                activate_script = venv_path / "bin" / "activate"
                if not activate_script.exists():
                    activate_script = venv_path / "Scripts" / "activate"

                if activate_script.exists():
                    with open(activate_script, 'r', encoding='utf-8') as f:
                        content = f.read()

                    # Marker to identify our custom env vars section
                    marker_start = "# --- dbt-ui env vars start ---"
                    marker_end = "# --- dbt-ui env vars end ---"

                    # Remove existing dbt-ui env vars section if present
                    pattern = re.compile(
                        rf'{re.escape(marker_start)}.*?{re.escape(marker_end)}\n?',
                        re.DOTALL
                    )
                    content = pattern.sub('', content)

                    # Build new env vars section
                    env_vars_lines = [marker_start]
                    for var_name, var_value in env_vars_to_set.items():
                        escaped_value = var_value.replace("'", "'\\''")
                        env_vars_lines.append(f"export {var_name}='{escaped_value}'")
                    env_vars_lines.append(marker_end)
                    env_vars_lines.append("")

                    new_content = content.rstrip() + "\n\n" + "\n".join(env_vars_lines)

                    with open(activate_script, 'w', encoding='utf-8') as f:
                        f.write(new_content)

                    output_lines.append(f"Loaded {len(env_vars_to_set)} environment variables: {', '.join(env_vars_to_set.keys())}")
                    print(f"[recreate-venv] Loaded {len(env_vars_to_set)} env vars into activate script")
                else:
                    output_lines.append("Warning: Could not find activate script to add env vars")
                    print(f"[recreate-venv] Warning: activate script not found")
            else:
                output_lines.append("No valid environment variables found in .dbt-ui-env")
        except Exception as e:
            output_lines.append(f"Warning: Error loading env vars from .dbt-ui-env: {str(e)}")
            print(f"[recreate-venv] Warning: Error loading env vars: {str(e)}")

    return {
        "success": True,
        "message": "Virtual environment created successfully",
        "dbt_version": dbt_version,
        "output": "\n".join(output_lines)
    }


@router.post("/api/recreate-venv")
async def recreate_venv(project_path: ProjectPath):
    """Delete existing venv and recreate it with all dependencies."""
    path = Path(project_path.path).expanduser().resolve()
    path_str = str(path)

    # Check if another operation is running for this worktree
    status = get_lock_status(path_str)
    if status["is_locked"]:
        raise HTTPException(
            status_code=409,
            detail=f"Another operation is already running: {status['operation']}"
        )

    # Try to acquire lock for this worktree
    if not acquire_lock(path_str, "Setting up environment"):
        raise HTTPException(
            status_code=409,
            detail=f"Another operation is already running: {get_lock_status(path_str)['operation']}"
        )

    try:
        # Run the blocking operation in a thread pool to avoid blocking the event loop
        result = await asyncio.to_thread(_recreate_venv_sync, project_path)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error recreating venv: {str(e)}")
    finally:
        release_lock(path_str)


@router.post("/api/check-venv")
async def check_venv(project_path: ProjectPath):
    """Check if virtual environment exists for the project."""
    path = Path(project_path.path).expanduser().resolve()

    if not path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    venv_path = get_venv_path(path)
    venv_exists = venv_path.exists()

    # Also check if dbt is installed in the venv
    dbt_installed = False
    dbt_version = ""
    if venv_exists:
        try:
            dbt_path = get_venv_dbt_path(path)
            dbt_installed = dbt_path.exists()

            # Get dbt version if installed
            if dbt_installed:
                venv_python = get_venv_python_path(path)
                version_result = run_command(
                    [str(venv_python), "-c", "import dbt.version; print(dbt.version.get_installed_version())"],
                    path,
                    timeout=10
                )
                if version_result.success:
                    dbt_version = version_result.stdout.strip()
        except FileNotFoundError:
            dbt_installed = False
        except Exception as e:
            print(f"[check-venv] Error getting dbt version: {e}")

    return {
        "venv_exists": venv_exists,
        "dbt_installed": dbt_installed,
        "dbt_version": dbt_version,
        "venv_path": str(venv_path)
    }
