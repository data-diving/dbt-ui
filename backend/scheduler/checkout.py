"""Project identity and dedicated git checkouts for scheduled jobs.

Scheduled runs never touch users' worktrees. Each job owns a detached worktree of the
repository's default branch with its own venv and dbt packages, built with the same
logic as the "Create virtual environment" action.
"""
import hashlib
import shutil
import subprocess
from contextlib import nullcontext
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import yaml
from fastapi import HTTPException

from models import ProjectPath
from routes.git_routes import get_default_branch, get_main_repo_path
from routes.venv_routes import _recreate_venv_sync
from scheduler import config
from utils.dbt_utils import get_dbt_env
from utils.subprocess_utils import git_askpass_env, run_command, run_git_command
from utils.venv_utils import get_venv_dbt_path, get_venv_path

GIT_TIMEOUT = 120
DEPS_TIMEOUT = 600
PACKAGE_FILES = ("packages.yml", "dependencies.yml", "package-lock.yml")


@dataclass
class ProjectInfo:
    project_key: str
    repo_path: str
    subdirectory: str
    worktree_root: str
    default_branch: str
    git_user_name: str


def make_project_key(repo_path: str, subdirectory: str) -> str:
    return f"{repo_path}::{subdirectory}" if subdirectory else repo_path


def resolve_project(path: Path) -> ProjectInfo:
    """Map a (worktree) project path to its main repository and subdirectory."""
    toplevel = run_git_command(["rev-parse", "--show-toplevel"], path, timeout=5)
    if not toplevel.success:
        raise ValueError("Project is not inside a git repository")
    worktree_root = Path(toplevel.stdout.strip()).resolve()
    repo_path = get_main_repo_path(path, worktree_root)
    try:
        subdirectory = str(path.resolve().relative_to(worktree_root))
    except ValueError:
        subdirectory = ""
    if subdirectory == ".":
        subdirectory = ""

    user_name = run_git_command(["config", "user.name"], path, timeout=5)
    default_branch = get_default_branch(Path(repo_path), Path(repo_path))
    return ProjectInfo(
        project_key=make_project_key(repo_path, subdirectory),
        repo_path=repo_path,
        subdirectory=subdirectory,
        worktree_root=str(worktree_root),
        default_branch=default_branch,
        git_user_name=user_name.stdout.strip() if user_name.success else "",
    )


def _has_origin(repo: Path) -> bool:
    return run_git_command(["remote", "get-url", "origin"], repo, timeout=5).success


def _git_env(git_creds: Optional[Dict[str, str]]):
    if git_creds and git_creds.get("username") and git_creds.get("password"):
        return git_askpass_env(git_creds["username"], git_creds["password"])
    return nullcontext(None)


def fetch_default_branch(repo: Path, branch: str, git_creds: Optional[Dict[str, str]]) -> None:
    """git fetch origin <branch>. Raises RuntimeError with git's message on failure."""
    if not _has_origin(repo):
        return
    with _git_env(git_creds) as env:
        if env is not None:
            env["GIT_TERMINAL_PROMPT"] = "0"
        result = run_git_command(["fetch", "origin", branch], repo, timeout=GIT_TIMEOUT, env=env)
    if not result.success:
        message = result.error.strip()
        if any(s in message.lower() for s in ("authentication", "could not read username", "403", "401")):
            raise RuntimeError(f"git fetch failed: credentials rejected. Refresh git credentials for the job.\n{message}")
        raise RuntimeError(f"git fetch failed:\n{message}")


def resolve_branch_sha(repo: Path, branch: str) -> str:
    """Latest known commit of the default branch: origin/<branch>, falling back to the local branch."""
    for ref in (f"refs/remotes/origin/{branch}", f"refs/heads/{branch}"):
        result = run_git_command(["rev-parse", "--verify", f"{ref}^{{commit}}"], repo, timeout=10)
        if result.success:
            return result.stdout.strip()
    raise RuntimeError(f"Default branch '{branch}' not found in {repo}")


def describe_commit(repo: Path, sha: str) -> Dict[str, str]:
    result = run_git_command(["log", "-1", "--format=%H%x1f%s%x1f%an%x1f%cI", sha], repo, timeout=10)
    if not result.success:
        return {"sha": sha, "subject": "", "author": "", "date": ""}
    parts = result.stdout.strip().split("\x1f")
    parts += [""] * (4 - len(parts))
    return {"sha": parts[0], "subject": parts[1], "author": parts[2], "date": parts[3]}


def checkout_root(job_id: int) -> Path:
    return config.settings.checkouts_dir / f"job-{job_id}"


def prepare_checkout(job_id: int, repo: Path, subdirectory: str, sha: str) -> Path:
    """Create or move the job's detached worktree to sha. Returns the dbt project directory."""
    root = checkout_root(job_id)
    root.parent.mkdir(parents=True, exist_ok=True)

    registered = str(root) in run_git_command(["worktree", "list", "--porcelain"], repo, timeout=10).stdout
    if not registered or not (root / ".git").exists():
        run_git_command(["worktree", "prune"], repo, timeout=10)
        if root.exists():
            shutil.rmtree(root)
        result = run_git_command(["worktree", "add", "--detach", str(root), sha], repo, timeout=GIT_TIMEOUT)
        if not result.success:
            raise RuntimeError(f"Failed to create job checkout:\n{result.error}")
    else:
        result = run_git_command(["checkout", "--detach", "--force", sha], root, timeout=GIT_TIMEOUT)
        if not result.success:
            raise RuntimeError(f"Failed to check out {sha[:12]}:\n{result.error}")
        # Remove leftovers from previous runs but keep the expensive environment
        run_git_command(
            ["clean", "-fdx", "-e", ".dbt-ui-venv", "-e", "dbt_packages"],
            root, timeout=GIT_TIMEOUT,
        )

    project_dir = root / subdirectory if subdirectory else root
    if not (project_dir / "dbt_project.yml").exists():
        raise RuntimeError(f"dbt_project.yml not found in {subdirectory or 'repository root'} at {sha[:12]}")
    return project_dir


def remove_checkout(job_id: int, repo: Optional[Path]) -> None:
    root = checkout_root(job_id)
    if repo is not None and repo.exists():
        run_git_command(["worktree", "remove", "--force", str(root)], repo, timeout=30)
        run_git_command(["worktree", "prune"], repo, timeout=10)
    if root.exists():
        shutil.rmtree(root, ignore_errors=True)


def _hash_files(project_dir: Path, names: Tuple[str, ...], extra: str = "") -> str:
    digest = hashlib.sha256(extra.encode())
    for name in names:
        file = project_dir / name
        digest.update(name.encode())
        if file.exists():
            digest.update(file.read_bytes())
    return digest.hexdigest()


def venv_fingerprint(project_dir: Path) -> str:
    """Changes when the Python environment must be rebuilt."""
    require = ""
    try:
        data = yaml.safe_load((project_dir / "dbt_project.yml").read_text(encoding="utf-8")) or {}
        require = str(data.get("require-dbt-version", ""))
    except (OSError, yaml.YAMLError):
        pass
    return _hash_files(project_dir, ("requirements.txt",), extra=require)


def deps_fingerprint(project_dir: Path) -> str:
    """Changes when dbt packages must be reinstalled."""
    return _hash_files(project_dir, PACKAGE_FILES)


def _has_package_file(project_dir: Path) -> bool:
    return (project_dir / "packages.yml").exists() or (project_dir / "dependencies.yml").exists()


def venv_python_ok(project_dir: Path) -> bool:
    """False when the venv's interpreter link is broken, e.g. the uv-managed Python it was built
    with lived in the container filesystem and is gone after the container was recreated."""
    return (get_venv_path(project_dir) / "bin" / "python").exists()


def ensure_environment(
    project_dir: Path,
    current_venv_fp: str,
    current_deps_fp: str,
    env_vars: Dict[str, str],
) -> Tuple[str, str, List[str]]:
    """Build the venv / run dbt deps when inputs changed. Returns new fingerprints and log lines."""
    log: List[str] = []
    new_venv_fp = venv_fingerprint(project_dir)
    new_deps_fp = deps_fingerprint(project_dir)

    venv_ok = get_venv_path(project_dir).exists() and venv_python_ok(project_dir)
    try:
        get_venv_dbt_path(project_dir)
    except FileNotFoundError:
        venv_ok = False

    if not venv_ok or new_venv_fp != current_venv_fp:
        log.append("[dbt-ui] Building virtual environment for the job checkout...")
        try:
            result = _recreate_venv_sync(ProjectPath(path=str(project_dir)))
        except HTTPException as e:
            detail = e.detail if isinstance(e.detail, dict) else {"message": str(e.detail)}
            raise RuntimeError(
                f"Failed to build virtual environment: {detail.get('message', '')}\n{detail.get('output', '')}"
            )
        log.append(result.get("output", ""))
        # _recreate_venv_sync already ran dbt deps
        return new_venv_fp, new_deps_fp, log

    packages_missing = _has_package_file(project_dir) and not (project_dir / "dbt_packages").exists()
    if _has_package_file(project_dir) and (new_deps_fp != current_deps_fp or packages_missing):
        log.append("[dbt-ui] Package files changed, running dbt deps...")
        dbt = get_venv_dbt_path(project_dir)
        try:
            result = run_command(
                [str(dbt), "deps", "--project-dir", str(project_dir), "--profiles-dir", str(project_dir)],
                project_dir, timeout=DEPS_TIMEOUT, env=get_dbt_env(project_dir, env_vars),
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"dbt deps timed out after {DEPS_TIMEOUT}s")
        log.append(result.output)
        if not result.success:
            raise RuntimeError(f"dbt deps failed:\n{result.error}")

    return new_venv_fp, new_deps_fp, log
