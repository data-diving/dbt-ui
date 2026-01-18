"""Environment variable management API routes."""
from fastapi import APIRouter, HTTPException, Request, Response
from pathlib import Path
from typing import Dict
import os
import re
import json
import base64
import hashlib

from models import EnvVarsRequest, SetEnvVarsRequest
from utils.venv_utils import get_venv_path

router = APIRouter()

# Cookie settings
COOKIE_NAME_PREFIX = "dbt_ui_env_"
COOKIE_MAX_AGE = 60 * 60 * 24 * 365  # 1 year


def get_cookie_name(project_path: str) -> str:
    """Generate a cookie name for a project path using a hash."""
    # Use a hash to create a safe cookie name from the project path
    path_hash = hashlib.md5(project_path.encode()).hexdigest()[:12]
    return f"{COOKIE_NAME_PREFIX}{path_hash}"


def get_env_vars_from_cookie(request: Request, project_path: str) -> Dict[str, str]:
    """Get environment variables from HttpOnly cookie."""
    cookie_name = get_cookie_name(project_path)
    cookie_value = request.cookies.get(cookie_name)

    if not cookie_value:
        return {}

    try:
        # Decode base64 and parse JSON
        decoded = base64.b64decode(cookie_value).decode('utf-8')
        return json.loads(decoded)
    except Exception as e:
        print(f"[env-routes] Error decoding cookie: {e}")
        return {}


def set_env_vars_cookie(response: Response, project_path: str, env_vars: Dict[str, str]):
    """Set environment variables in HttpOnly cookie."""
    cookie_name = get_cookie_name(project_path)

    # Encode as JSON then base64 for safe cookie storage
    json_str = json.dumps(env_vars)
    encoded = base64.b64encode(json_str.encode('utf-8')).decode('utf-8')

    response.set_cookie(
        key=cookie_name,
        value=encoded,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=False,  # Set to True in production with HTTPS
    )


@router.post("/api/scan-env-vars")
async def scan_env_vars(request: EnvVarsRequest):
    """Scan SQL and YML files in the project for environment variable references."""
    path = Path(request.path).expanduser().resolve()

    if not path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    # Directories to ignore (directories starting with '.' are already skipped separately)
    ignore_dirs = {
        'target', 'venv', '__pycache__', 'node_modules',
        'dbt_packages', 'logs', 'py_cache'
    }

    # Patterns to match env var references in dbt/Jinja
    # {{ env_var('VAR_NAME') }} or {{ env_var("VAR_NAME") }} or {{ env_var('VAR_NAME', 'default') }}
    env_var_pattern = re.compile(r"""\{\{\s*env_var\s*\(\s*['"]([^'"]+)['"]""", re.IGNORECASE)

    found_env_vars: Dict[str, Dict] = {}

    def scan_file(file_path: Path):
        """Scan a single file for env var references."""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()

            matches = env_var_pattern.findall(content)
            for var_name in matches:
                if var_name not in found_env_vars:
                    found_env_vars[var_name] = {
                        "name": var_name,
                        "files": [],
                        "current_value": os.environ.get(var_name, "")
                    }
                rel_path = str(file_path.relative_to(path))
                if rel_path not in found_env_vars[var_name]["files"]:
                    found_env_vars[var_name]["files"].append(rel_path)

        except Exception as e:
            print(f"[scan-env-vars] Error reading {file_path}: {e}")

    def scan_directory(dir_path: Path):
        """Recursively scan directory for SQL and YML files."""
        try:
            for item in dir_path.iterdir():
                # Skip ignored directories
                if item.is_dir():
                    if item.name in ignore_dirs or item.name.startswith('.'):
                        continue
                    scan_directory(item)
                elif item.is_file():
                    # Only scan SQL and YML/YAML files
                    if item.suffix.lower() in ['.sql', '.yml', '.yaml']:
                        scan_file(item)
        except PermissionError:
            pass

    scan_directory(path)

    # Also check for env vars that might be set in the venv's activate script
    # and read current values from the environment
    venv_env_vars: Dict[str, str] = {}
    venv_path = get_venv_path(path)
    activate_script = venv_path / "bin" / "activate"

    if activate_script.exists():
        try:
            with open(activate_script, 'r', encoding='utf-8') as f:
                content = f.read()

            # Look for export VAR_NAME=value lines that were added
            export_pattern = re.compile(r'^export\s+([A-Z_][A-Z0-9_]*)=["\']?([^"\']*)["\']?', re.MULTILINE)
            for match in export_pattern.finditer(content):
                var_name, var_value = match.groups()
                if var_name in found_env_vars:
                    venv_env_vars[var_name] = var_value

        except Exception as e:
            print(f"[scan-env-vars] Error reading activate script: {e}")

    # Update current values from venv if available
    for var_name, var_value in venv_env_vars.items():
        if var_name in found_env_vars:
            found_env_vars[var_name]["venv_value"] = var_value

    return {
        "env_vars": list(found_env_vars.values()),
        "count": len(found_env_vars)
    }


@router.post("/api/set-env-vars")
async def set_env_vars(request: SetEnvVarsRequest, response: Response):
    """Set environment variables in HttpOnly cookie (stored per-project)."""
    path = Path(request.path).expanduser().resolve()

    if not path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    # Sanitize variable names
    sanitized_env_vars: Dict[str, str] = {}
    for var_name, var_value in request.env_vars.items():
        if re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', var_name):
            sanitized_env_vars[var_name] = var_value

    # Store in HttpOnly cookie
    set_env_vars_cookie(response, str(path), sanitized_env_vars)

    return {
        "success": True,
        "message": f"Set {len(sanitized_env_vars)} environment variables",
        "env_vars_set": list(sanitized_env_vars.keys())
    }


@router.post("/api/get-env-vars")
async def get_env_vars(request: EnvVarsRequest, http_request: Request):
    """Get environment variables from HttpOnly cookie."""
    path = Path(request.path).expanduser().resolve()

    if not path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    # Read from HttpOnly cookie
    env_vars = get_env_vars_from_cookie(http_request, str(path))

    return {
        "env_vars": env_vars
    }
