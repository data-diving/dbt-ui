"""MetaDV API routes."""
import os
from fastapi import APIRouter, Request
from pydantic import BaseModel
from pathlib import Path
from typing import Optional
import subprocess
import json as json_module
import re
import yaml

from models import ProjectPath
from utils.dbt_utils import get_dbt_env
from routes.env_routes import get_env_vars_from_cookie
from utils.subprocess_utils import run_command
from metadv import (
    MetaDVGenerator,
    validate_metadv,
    read_metadv,
    detect_installed_dv_package,
    SUPPORTED_DV_PACKAGES,
)


def is_metadv_enabled() -> bool:
    """Check if MetaDV feature is enabled via environment variable."""
    return os.environ.get("DBT_UI__METADV_ENABLED", "true").lower() in ("true", "1", "yes")

router = APIRouter()


class MetaDVSaveRequest(BaseModel):
    """Request model for saving MetaDV data."""
    path: str
    data: dict


class MetaDVSourceColumnsRequest(BaseModel):
    """Request model for fetching source model columns."""
    path: str
    source_name: str  # Model name (used with ref() macro)
    target: Optional[str] = None


@router.post("/api/check-metadv-package")
async def check_metadv_package(project_path: ProjectPath):
    """Check if a supported package is installed in the project.

    Supported packages:
    - Datavault-UK/automate_dv
    - ScalefreeCOM/datavault4dbt
    """
    metadv_enabled = is_metadv_enabled()
    if not metadv_enabled:
        return {"has_metadv_package": False, "metadv_enabled": False, "error": None, "package_name": None}

    path = Path(project_path.path).expanduser().resolve()

    if not path.exists():
        return {"has_metadv_package": False, "metadv_enabled": True, "error": "Project path does not exist", "package_name": None}

    package_name = detect_installed_dv_package(path)
    return {
        "has_metadv_package": package_name is not None,
        "metadv_enabled": True,
        "error": None,
        "package_name": package_name
    }


@router.post("/api/metadv-init")
async def metadv_init(project_path: ProjectPath):
    """Initialize MetaDV folder and metadv.yml file."""
    if not is_metadv_enabled():
        return {"success": False, "error": "MetaDV feature is disabled", "data": None}

    path = Path(project_path.path).expanduser().resolve()

    if not path.exists():
        return {"success": False, "error": "Project path does not exist", "data": None}

    models_path = path / "models"
    metadv_path = models_path / "metadv"
    metadv_yml_path = metadv_path / "metadv.yml"

    try:
        if not models_path.exists():
            models_path.mkdir(parents=True)

        if not metadv_path.exists():
            metadv_path.mkdir(parents=True)

        if not metadv_yml_path.exists():
            # Both targets and sources under metadv key
            initial_content = {'metadv': {'targets': [], 'sources': []}}
            with open(metadv_yml_path, 'w', encoding='utf-8') as f:
                yaml.dump(initial_content, f, default_flow_style=False, sort_keys=False)

        with open(metadv_yml_path, 'r', encoding='utf-8') as f:
            content = yaml.safe_load(f)

        return {"success": True, "error": None, "data": content, "path": str(metadv_yml_path)}

    except Exception as e:
        return {"success": False, "error": str(e), "data": None}


@router.post("/api/metadv-read")
async def metadv_read(project_path: ProjectPath):
    """Read and parse metadv.yml file."""
    if not is_metadv_enabled():
        return {"success": False, "error": "MetaDV feature is disabled", "data": None}

    path = Path(project_path.path).expanduser().resolve()

    if not path.exists():
        return {"success": False, "error": "Project path does not exist", "data": None}

    metadv_yml_path = path / "models" / "metadv" / "metadv.yml"

    if not metadv_yml_path.exists():
        return {"success": False, "error": "metadv.yml not found. Please initialize MetaDV first.", "data": None}

    try:
        with open(metadv_yml_path, 'r', encoding='utf-8') as f:
            content = yaml.safe_load(f)

        metadv_section = content.get('metadv', {}) or {}
        targets = metadv_section.get('targets', []) or []

        source_columns = []
        # Sources are under metadv key (same as targets)
        # Each source has a name (model name) and columns directly
        sources = metadv_section.get('sources', []) or []
        for source in sources:
            source_name = source.get('name', '')
            columns = source.get('columns', [])
            for column in columns:
                col_name = column.get('name', '')

                # Unified structure: target array directly on column (no meta wrapper)
                target = column.get('target', None)

                # Backwards compatibility: check for old meta-wrapped format
                if target is None:
                    meta = column.get('meta', {}) or {}
                    target = meta.get('target', None)

                    # Even older formats: entity_name/attribute_of as separate fields
                    if target is None:
                        target = []

                        # Old entity_name/entity_relation format
                        old_entity_name = meta.get('entity_name', None)
                        entity_name_index = meta.get('entity_name_index', None)
                        entity_relation = meta.get('entity_relation', None)

                        if old_entity_name is not None:
                            if isinstance(old_entity_name, str):
                                old_entity_name = [old_entity_name]
                            for en in old_entity_name:
                                if entity_relation:
                                    target_entry = {'target_name': entity_relation, 'entity_name': en}
                                else:
                                    target_entry = {'target_name': en}
                                if entity_name_index is not None:
                                    target_entry['entity_index'] = entity_name_index
                                target.append(target_entry)

                        # Old attribute_of format (separate field)
                        old_attribute_of = meta.get('attribute_of', None)
                        old_target_attribute = meta.get('target_attribute', None)
                        old_multiactive_key = meta.get('multiactive_key', None)

                        if old_attribute_of is not None:
                            if isinstance(old_attribute_of, str):
                                old_attribute_of = [old_attribute_of]
                            for attr_target in old_attribute_of:
                                attr_entry = {'attribute_of': attr_target}
                                if old_target_attribute:
                                    attr_entry['target_attribute'] = old_target_attribute
                                if old_multiactive_key:
                                    attr_entry['multiactive_key'] = True
                                target.append(attr_entry)

                col_data = {
                    'source': source_name,
                    'column': col_name,
                    'target': target if target else None
                }

                source_columns.append(col_data)

        return {
            "success": True,
            "error": None,
            "data": {"targets": targets, "source_columns": source_columns, "raw": content},
            "path": str(metadv_yml_path)
        }

    except Exception as e:
        return {"success": False, "error": str(e), "data": None}


@router.post("/api/metadv-save")
async def metadv_save(request: MetaDVSaveRequest):
    """Save MetaDV data to metadv.yml file."""
    if not is_metadv_enabled():
        return {"success": False, "error": "MetaDV feature is disabled"}

    path = Path(request.path).expanduser().resolve()

    if not path.exists():
        return {"success": False, "error": "Project path does not exist"}

    metadv_yml_path = path / "models" / "metadv" / "metadv.yml"
    metadv_yml_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        with open(metadv_yml_path, 'w', encoding='utf-8') as f:
            yaml.dump(request.data, f, default_flow_style=False, sort_keys=False, allow_unicode=True)

        return {"success": True, "error": None, "path": str(metadv_yml_path)}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/metadv-source-columns")
async def metadv_source_columns(request: MetaDVSourceColumnsRequest, http_request: Request):
    """Fetch column names from a source model using dbt show.

    Uses the dbt ref() function to query an existing model.
    The source_name should be an existing dbt model name.
    """
    if not is_metadv_enabled():
        return {"success": False, "error": "MetaDV feature is disabled", "columns": []}

    path = Path(request.path).expanduser().resolve()

    if not path.exists():
        return {"success": False, "error": "Project path does not exist", "columns": []}

    venv_path = path / ".dbt-ui-venv"
    if not venv_path.exists():
        return {"success": False, "error": "Virtual environment not found", "columns": []}

    dbt_executable = str(venv_path / "bin" / "dbt")

    try:
        # Use dbt ref() function - the source_name is an existing model name
        inline_sql = f"select * from {{{{ ref('{request.source_name}') }}}}"

        cmd = [
            dbt_executable, "show",
            "--inline", inline_sql,
            "--limit", "1",
            "--output", "json",
            "--project-dir", str(path),
            "--profiles-dir", str(path)
        ]

        if request.target:
            cmd.extend(["--target", request.target])

        print(f"[metadv-source-columns] Running: {' '.join(cmd)}")

        env_vars = get_env_vars_from_cookie(http_request, str(path))
        env = get_dbt_env(path, env_vars)

        result = run_command(cmd, path, timeout=120, env=env)

        print(f"[metadv-source-columns] Return code: {result.returncode}")

        if not result.success:
            return {"success": False, "error": result.error or "Unknown error", "columns": []}

        stdout = result.stdout.strip()
        if not stdout:
            return {"success": False, "error": "No output from dbt show", "columns": []}

        columns = []

        json_match = re.search(r'\{[\s\S]*\}', stdout)
        if json_match:
            json_str = json_match.group()
            try:
                data = json_module.loads(json_str)
                if isinstance(data, dict):
                    if 'show' in data and isinstance(data['show'], list):
                        show_data = data['show']
                        if show_data and len(show_data) > 0:
                            columns = list(show_data[0].keys())
                    elif 'data' in data and isinstance(data['data'], dict) and 'preview' in data['data']:
                        preview = data['data']['preview']
                        if preview and len(preview) > 0:
                            columns = list(preview[0].keys())
                    elif 'preview' in data:
                        preview = data['preview']
                        if preview and len(preview) > 0:
                            columns = list(preview[0].keys())
                    elif 'results' in data and isinstance(data['results'], list):
                        for res in data['results']:
                            if isinstance(res, dict) and 'agate_table' in res:
                                agate = res['agate_table']
                                if 'column_names' in agate:
                                    columns = agate['column_names']
                                    break
            except json_module.JSONDecodeError as e:
                print(f"[metadv-source-columns] JSON decode error: {e}")

        if not columns:
            return {"success": False, "error": "Could not extract columns from query result", "columns": []}

        print(f"[metadv-source-columns] Found columns: {columns}")

        return {"success": True, "error": None, "columns": columns, "source": request.source_name}

    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Query timed out after 2 minutes", "columns": []}
    except Exception as e:
        print(f"[metadv-source-columns] Exception: {e}")
        return {"success": False, "error": str(e), "columns": []}


@router.post("/api/metadv-validate")
async def metadv_validate(project_path: ProjectPath):
    """Validate metadv.yml configuration.

    Returns a list of errors and warnings:
    - error: each relation target must have sources for its entities
    - warning: each entity target should have a source for entity
    - warning: each target should have a description
    - warning: each source column should have a connection to a target
    """
    if not is_metadv_enabled():
        return {"success": False, "error": "MetaDV feature is disabled", "errors": [], "warnings": []}

    path = Path(project_path.path).expanduser().resolve()
    package_name = detect_installed_dv_package(path)

    if not package_name:
        return {
            "success": False,
            "error": f"No supported Data Vault package found. Please install one of: {', '.join(SUPPORTED_DV_PACKAGES)}",
            "errors": [],
            "warnings": []
        }

    # Use the shared validation logic from metadv.py
    return validate_metadv(project_path.path, package_name)


@router.post("/api/metadv-generate")
async def metadv_generate(project_path: ProjectPath):
    """Generate SQL models from metadv.yml configuration.

    Generates the following structure:
    - stage/stg_<source>__<table>.sql - One per source table with target connections
    - hub/hub_<entity>.sql - One per entity target
    - link/link_<entity1>_<entity2>_...sql - One per relation target
    - sat/sat_<target>__<source>__<table>.sql - One per source table-target pair
    """
    if not is_metadv_enabled():
        return {"success": False, "error": "MetaDV feature is disabled", "generated_files": []}

    path = Path(project_path.path).expanduser().resolve()

    if not path.exists():
        return {"success": False, "error": "Project path does not exist", "generated_files": []}

    try:
        # Detect installed DV package to pass to generator
        package_name = detect_installed_dv_package(path)

        if not package_name:
            return {
                "success": False,
                "error": f"No supported Data Vault package found. Please install one of: {', '.join(SUPPORTED_DV_PACKAGES)}",
                "generated_files": []
            }

        generator = MetaDVGenerator(str(path), package_name)
        success, error, generated_files = generator.generate()

        return {
            "success": success,
            "error": error,
            "generated_files": generated_files,
            "package_name": package_name
        }
    except Exception as e:
        return {"success": False, "error": str(e), "generated_files": []}
