"""Utility functions for interacting with dbt projects."""
from pathlib import Path
from typing import Dict, Any, Optional
import subprocess
import json
import os

from utils.subprocess_utils import run_command


def get_dbt_env(project_path: Path, env_vars: Dict[str, str] = None) -> Dict[str, str]:
    """
    Get environment variables for running dbt commands.

    Args:
        project_path: Path to the dbt project
        env_vars: Environment variables from HttpOnly cookie (for dbt run/compile/test/seed only)
    """
    env = os.environ.copy()

    # Add terminal settings to prevent line wrapping
    env['COLUMNS'] = '500'
    env['TERM'] = 'dumb'

    # Add env vars passed from frontend
    if env_vars:
        for var_name, var_value in env_vars.items():
            env[var_name] = var_value

    return env


def get_dbt_executable(project_path: Path) -> str:
    """
    Get the path to the dbt executable for the project.
    First checks project venv, falls back to global dbt.

    Args:
        project_path: Path to the dbt project

    Returns:
        Path to dbt executable as string
    """
    venv_path = project_path / ".dbt-ui-venv"

    # Check for Unix-style path first
    dbt_path = venv_path / "bin" / "dbt"
    if dbt_path.exists():
        print(f"[get_dbt_executable] Using venv dbt: {dbt_path}")
        return str(dbt_path)

    # Check for Windows-style path
    dbt_path = venv_path / "Scripts" / "dbt.exe"
    if dbt_path.exists():
        print(f"[get_dbt_executable] Using venv dbt: {dbt_path}")
        return str(dbt_path)

    # Fall back to global dbt
    print(f"[get_dbt_executable] No venv dbt found, using global dbt")
    return "dbt"


def parse_dbt_manifest(project_path: Path) -> Optional[Dict[str, Any]]:
    """
    Parse the dbt manifest.json file to get model metadata.

    Args:
        project_path: Path to the dbt project

    Returns:
        Parsed manifest as a dictionary, or None if not found
    """
    manifest_path = project_path / "target" / "manifest.json"

    if not manifest_path.exists():
        return None

    try:
        with open(manifest_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error parsing manifest: {e}")
        return None


def compile_dbt_project(project_path: Path) -> tuple[bool, Optional[str]]:
    """
    Run dbt compile/parse to generate manifest.json.
    Uses the project's venv dbt if available, falls back to global dbt.

    Args:
        project_path: Path to the dbt project

    Returns:
        Tuple of (success, error_message)
    """
    try:
        # Get the dbt executable for this project
        dbt_cmd = get_dbt_executable(project_path)

        # Get environment with dbt-ui env vars loaded
        env = get_dbt_env(project_path)

        # Try dbt parse first (faster, doesn't compile SQL)
        print(f"Running dbt parse in {project_path}")
        result = run_command(
            [dbt_cmd, "parse", "--project-dir", str(project_path), "--profiles-dir", str(project_path)],
            project_path,
            timeout=120,
            env=env
        )

        parse_error = result.output

        if result.success:
            print("dbt parse succeeded")
            # Check if manifest.json was actually created
            manifest_path = project_path / "target" / "manifest.json"
            if manifest_path.exists():
                print("manifest.json found after dbt parse")
                return (True, None)
            else:
                print("manifest.json not found after dbt parse, falling back to dbt compile")

        if not result.success:
            print(f"dbt parse failed with return code {result.returncode}")
            print(f"stdout: {result.stdout}")
            print(f"stderr: {result.stderr}")

        # If parse fails or didn't create manifest, fall back to compile
        print(f"Running dbt compile in {project_path}")
        result = run_command(
            [dbt_cmd, "compile", "--project-dir", str(project_path), "--profiles-dir", str(project_path)],
            project_path,
            timeout=180,
            env=env
        )

        if result.success:
            print("dbt compile succeeded")
            # Verify manifest.json exists
            manifest_path = project_path / "target" / "manifest.json"
            if manifest_path.exists():
                print("manifest.json found after dbt compile")
                return (True, None)
            else:
                error_msg = "dbt compile succeeded but manifest.json was not created"
                print(error_msg)
                return (False, error_msg)

        compile_error = result.output
        print(f"dbt compile failed with return code {result.returncode}")
        print(f"stdout: {result.stdout}")
        print(f"stderr: {result.stderr}")

        # Return the compile error (or parse error if compile also failed)
        return (False, compile_error or parse_error or "Unknown compilation error")

    except Exception as e:
        error_msg = str(e)
        print(f"Error compiling dbt project: {error_msg}")
        return (False, error_msg)


def get_node_from_manifest(manifest: Dict[str, Any], node_name: str, node_type: str = 'model') -> Optional[Dict[str, Any]]:
    """
    Extract a specific node from the manifest.

    Args:
        manifest: The parsed manifest dictionary
        node_name: Name of the node (without prefix)
        node_type: Type of node ('model', 'seed', 'source', 'macro', etc.)

    Returns:
        Node data or None if not found
    """
    if not manifest or 'nodes' not in manifest:
        return None

    # Search in nodes
    for node_id, node_data in manifest['nodes'].items():
        if node_data.get('name') == node_name and node_data.get('resource_type') == node_type:
            return node_data

    # Search in sources if type is source
    if node_type == 'source' and 'sources' in manifest:
        for source_id, source_data in manifest['sources'].items():
            if source_data.get('name') == node_name:
                return source_data

    # Search in macros if type is macro
    if node_type == 'macro' and 'macros' in manifest:
        for macro_id, macro_data in manifest['macros'].items():
            if macro_data.get('name') == node_name:
                return macro_data

    return None


def extract_model_metadata(node_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract relevant metadata from a dbt node.

    Args:
        node_data: Node data from manifest

    Returns:
        Simplified metadata dictionary
    """
    metadata = {
        'name': node_data.get('name'),
        'type': node_data.get('resource_type', 'unknown'),
        'description': node_data.get('description', ''),
        'database': node_data.get('database'),
        'schema': node_data.get('schema'),
        'alias': node_data.get('alias'),
    }

    # Add columns if available
    if 'columns' in node_data and node_data['columns']:
        metadata['columns'] = [
            {
                'name': col_name,
                'description': col_data.get('description', ''),
                'data_type': col_data.get('data_type'),
                'meta': col_data.get('meta', {})
            }
            for col_name, col_data in node_data['columns'].items()
        ]

    # Add config
    if 'config' in node_data:
        config = node_data['config']
        metadata['materialized'] = config.get('materialized')
        metadata['tags'] = config.get('tags', [])

    # Add meta
    if 'meta' in node_data:
        metadata['meta'] = node_data['meta']

    # Add tags at top level
    if 'tags' in node_data:
        metadata['tags'] = node_data['tags']

    # Add tests
    if 'tests' in node_data:
        metadata['tests'] = node_data['tests']

    # Add dependencies
    if 'depends_on' in node_data:
        metadata['depends_on'] = node_data['depends_on']

    # Remove None values
    metadata = {k: v for k, v in metadata.items() if v is not None and v != '' and v != []}

    return metadata