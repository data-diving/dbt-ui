"""Virtual environment utility functions."""
from pathlib import Path
from typing import Optional
import subprocess
import shutil

from utils.subprocess_utils import run_command


def get_venv_path(project_path: Path) -> Path:
    """Get the path to the virtual environment for a project."""
    return project_path / ".dbt-ui-venv"


def ensure_venv_exists(project_path: Path) -> bool:
    """
    Ensure a virtual environment exists for the project.
    Creates it if it doesn't exist using uv venv.
    Returns True if venv exists or was created successfully, False otherwise.
    """
    venv_path = get_venv_path(project_path)

    # Check if venv already exists
    if venv_path.exists():
        # Verify it's a valid venv by checking for bin/python or Scripts/python.exe
        if (venv_path / "bin" / "python").exists() or (venv_path / "Scripts" / "python.exe").exists():
            print(f"[ensure_venv_exists] Virtual environment already exists at {venv_path}")
            return True
        else:
            print(f"[ensure_venv_exists] Invalid venv directory found at {venv_path}, removing...")
            shutil.rmtree(venv_path)

    # Create new venv
    try:
        print(f"[ensure_venv_exists] Creating virtual environment at {venv_path}")
        result = run_command(["uv", "venv", str(venv_path)], project_path, timeout=60)

        if result.success:
            print(f"[ensure_venv_exists] Virtual environment created successfully")
            return True
        else:
            print(f"[ensure_venv_exists] Failed to create venv: {result.stderr}")
            return False
    except Exception as e:
        print(f"[ensure_venv_exists] Error creating venv: {e}")
        return False


def get_venv_python_path(project_path: Path) -> Path:
    """Get the path to the Python executable in the project's virtual environment."""
    venv_path = get_venv_path(project_path)

    # Check for Unix-style path first
    python_path = venv_path / "bin" / "python"
    if python_path.exists():
        return python_path

    # Check for Windows-style path
    python_path = venv_path / "Scripts" / "python.exe"
    if python_path.exists():
        return python_path

    raise FileNotFoundError(f"Python executable not found in virtual environment at {venv_path}")


def get_venv_dbt_path(project_path: Path) -> Path:
    """Get the path to the dbt executable in the project's virtual environment."""
    venv_path = get_venv_path(project_path)

    # Check for Unix-style path first
    dbt_path = venv_path / "bin" / "dbt"
    if dbt_path.exists():
        return dbt_path

    # Check for Windows-style path
    dbt_path = venv_path / "Scripts" / "dbt.exe"
    if dbt_path.exists():
        return dbt_path

    raise FileNotFoundError(f"dbt executable not found in virtual environment at {venv_path}")


def get_installed_package_version(package_name: str, venv_python: Optional[Path] = None) -> Optional[str]:
    """
    Get the currently installed version of a package using uv pip.
    If venv_python is provided, checks the package in that virtual environment.
    """
    try:
        if venv_python:
            # Check package in specific venv
            # Note: cwd is set to venv parent directory (worktree) for isolation
            venv_dir = Path(venv_python).parent.parent.parent  # .dbt-ui-venv/bin/python -> worktree
            result = run_command(
                ["uv", "pip", "show", "--python", str(venv_python), package_name],
                venv_dir,
                timeout=10
            )
        else:
            # Check package globally (backward compatibility)
            result = run_command(["uv", "pip", "show", package_name], Path.cwd(), timeout=10)

        if result.success:
            # Parse output to find Version line
            for line in result.stdout.split('\n'):
                if line.startswith('Version:'):
                    return line.split(':', 1)[1].strip()
        return None
    except Exception:
        return None


def version_satisfies_constraint(installed_version: str, constraint: str) -> bool:
    """Check if installed version satisfies the constraint."""
    import re
    from packaging import version

    if not constraint:
        # No constraint means any version is OK
        return True

    # Parse constraint operator and version
    match = re.match(r'([><=!~]+)(.+)', constraint)
    if not match:
        return False

    operator, required_version = match.groups()
    installed_ver = version.parse(installed_version)
    required_ver = version.parse(required_version)

    if operator == '==':
        return installed_ver == required_ver
    elif operator == '>=':
        return installed_ver >= required_ver
    elif operator == '<=':
        return installed_ver <= required_ver
    elif operator == '>':
        return installed_ver > required_ver
    elif operator == '<':
        return installed_ver < required_ver
    elif operator.startswith('~='):
        # Compatible release: same major.minor version
        return (installed_ver.major == required_ver.major and
                installed_ver.minor == required_ver.minor and
                installed_ver >= required_ver)

    return False
