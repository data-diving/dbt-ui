"""Git-related API routes."""
from fastapi import APIRouter, HTTPException, Request, Response
from pathlib import Path
from typing import List
import subprocess
import hashlib
import shutil
import re
import os
import json
import base64

from models import (
    ProjectPath, GitRepoUrl, GitTrackedRequest, RestoreFileRequest,
    SetupWorktreeRequest, GitStageRequest, GitCommitRequest,
    GitCreateBranchRequest, GitStagedFilesRequest, GitPushPullRequest
)
from utils.input_validation import (
    validate_git_user_name, validate_git_user_email, validate_git_branch_name,
    validate_file_path, validate_commit_message
)
from utils.subprocess_utils import run_command, run_git_command, git_askpass_env

router = APIRouter()

# Git credentials cookie settings
GIT_CREDS_COOKIE_PREFIX = "dbt_ui_git_creds_"
GIT_CREDS_COOKIE_MAX_AGE = int(os.environ.get("DBT_UI__BACKEND_GIT_CREDS_COOKIE_MAX_AGE", 60 * 60 * 24 * 30))  # Default: 30 days


def get_git_creds_cookie_name(git_root: str) -> str:
    """Generate a cookie name for git credentials based on git root path."""
    path_hash = hashlib.md5(git_root.encode()).hexdigest()[:12]
    return f"{GIT_CREDS_COOKIE_PREFIX}{path_hash}"


def get_git_credentials_from_cookie(request: Request, git_root: str) -> dict:
    """Get git credentials from HttpOnly cookie."""
    cookie_name = get_git_creds_cookie_name(git_root)
    cookie_value = request.cookies.get(cookie_name)

    if not cookie_value:
        return {}

    try:
        decoded = base64.b64decode(cookie_value).decode('utf-8')
        return json.loads(decoded)
    except Exception as e:
        print(f"[git-routes] Error decoding credentials cookie: {e}")
        return {}


def set_git_credentials_cookie(response: Response, git_root: str, username: str, password: str):
    """Store git credentials in HttpOnly cookie."""
    cookie_name = get_git_creds_cookie_name(git_root)
    creds = {"username": username, "password": password}
    json_str = json.dumps(creds)
    encoded = base64.b64encode(json_str.encode('utf-8')).decode('utf-8')

    response.set_cookie(
        key=cookie_name,
        value=encoded,
        max_age=GIT_CREDS_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=False,  # Set to True in production with HTTPS
    )


def get_stored_username_from_cookie(request: Request, git_root: str) -> str:
    """Get only the username from stored credentials (for pre-filling forms)."""
    creds = get_git_credentials_from_cookie(request, git_root)
    return creds.get("username", "")


def get_main_repo_path(path: Path, git_root: Path) -> str:
    """Get the main repository path, handling both regular repos and worktrees.

    For worktrees, credentials are stored under the main repo path, not the worktree path.
    This function returns the main repo path in both cases.

    Args:
        path: Working directory to run commands in
        git_root: The git root path (may be worktree or main repo)

    Returns:
        The main repository path as a string
    """
    # Check if this is a worktree by comparing git-dir and git-common-dir
    git_dir_result = run_git_command(['rev-parse', '--git-dir'], path, git_root, timeout=5)
    common_dir_result = run_git_command(['rev-parse', '--git-common-dir'], path, git_root, timeout=5)

    if git_dir_result.success and common_dir_result.success:
        git_dir = git_dir_result.stdout.strip()
        common_dir = common_dir_result.stdout.strip()

        # If they're different, this is a worktree - get main repo from common dir
        if git_dir != common_dir:
            # common_dir points to the .git folder of the main repo
            # The main repo path is the parent of .git
            common_path = Path(common_dir).resolve()
            if common_path.name == '.git':
                return str(common_path.parent)
            # Handle bare repos or unusual structures
            return str(common_path.parent)

    # Not a worktree, return the git root as-is
    return str(git_root)


def get_git_repos_path() -> Path:
    """Get the path for storing cloned git repositories.

    Uses GIT_REPOS_PATH environment variable if set, otherwise defaults to ~/git-repos.
    """
    env_path = os.environ.get("GIT_REPOS_PATH")
    if env_path:
        return Path(env_path).expanduser().resolve()
    return Path.home() / "git-repos"


def get_default_branch(git_root: Path, cwd: Path) -> str:
    """Get the default branch name (main or master) for a git repository.

    First tries to get from remote HEAD, then falls back to checking local branches.

    Args:
        git_root: Path to the git repository root
        cwd: Working directory to run commands in (for isolation)

    Returns:
        The default branch name, or empty string if not found
    """
    # Try to get from remote HEAD
    result = run_git_command(['symbolic-ref', 'refs/remotes/origin/HEAD'], cwd, git_root, timeout=5)
    if result.success:
        return result.stdout.strip().split('/')[-1]

    # Fallback: check if main or master exists
    for candidate in ['main', 'master']:
        result = run_git_command(['branch', '--list', candidate], cwd, git_root, timeout=5)
        if result.stdout.strip():
            return candidate

    return ""


class GitFileStatus:
    """Result of git file status check."""
    def __init__(self, modified: List[str] = None, deleted: List[str] = None, untracked: List[str] = None):
        self.modified = modified or []
        self.deleted = deleted or []
        self.untracked = untracked or []


def get_git_file_status(project_path: Path) -> GitFileStatus:
    """Get git file status (modified, deleted, untracked) for a project path.

    Returns paths relative to the project path, handling cases where
    the project is in a subdirectory of the git repo.
    """
    status = GitFileStatus()

    try:
        # Check if this is a git repository
        git_check = run_git_command(['rev-parse', '--git-dir'], project_path, timeout=5)
        if not git_check.success:
            return status

        # Get the git repository root
        git_root_result = run_git_command(['rev-parse', '--show-toplevel'], project_path, timeout=5)
        if not git_root_result.success:
            return status

        git_root = Path(git_root_result.stdout.strip())

        # Calculate relative path from git root to project path
        try:
            relative_to_git_root = project_path.relative_to(git_root)
        except ValueError:
            relative_to_git_root = Path(".")

        prefix = str(relative_to_git_root) + "/" if relative_to_git_root != Path(".") else ""

        def filter_and_strip(files: List[str]) -> List[str]:
            """Filter files to project subdirectory and strip prefix."""
            if not prefix:
                return files
            return [f[len(prefix):] for f in files if f.startswith(prefix)]

        # Get deleted files (exist in HEAD but deleted locally)
        cmd_result = run_git_command(['diff', '--name-only', '--diff-filter=D', 'HEAD'], project_path, git_root, timeout=10)
        if cmd_result.success and cmd_result.stdout:
            raw_deleted = [f.strip() for f in cmd_result.stdout.split('\n') if f.strip()]
            status.deleted = filter_and_strip(raw_deleted)

        # Get modified files (changed from HEAD)
        cmd_result = run_git_command(['diff', '--name-only', '--diff-filter=M', 'HEAD'], project_path, git_root, timeout=10)
        if cmd_result.success and cmd_result.stdout:
            raw_modified = [f.strip() for f in cmd_result.stdout.split('\n') if f.strip()]
            status.modified = filter_and_strip(raw_modified)

        # Get untracked files
        cmd_result = run_git_command(['ls-files', '--others', '--exclude-standard'], project_path, git_root, timeout=10)
        if cmd_result.success and cmd_result.stdout:
            raw_untracked = [f.strip() for f in cmd_result.stdout.split('\n') if f.strip()]
            status.untracked = filter_and_strip(raw_untracked)

        print(f"[get_git_file_status] Git root: {git_root}, Project relative: {relative_to_git_root}")
        print(f"[get_git_file_status] Modified: {len(status.modified)}, Deleted: {len(status.deleted)}, Untracked: {len(status.untracked)}")

    except Exception as e:
        print(f"[get_git_file_status] Error: {e}")

    return status


@router.post("/api/clone-git-repo")
async def clone_git_repo(git_repo: GitRepoUrl, http_request: Request, response: Response):
    """Clone a Git repository to a local cache directory and return the path."""
    git_url = git_repo.git_url.strip()
    username = git_repo.username
    password = git_repo.password

    # Parse URL to extract repo URL and subdirectory if present
    # GitHub URLs like: https://github.com/user/repo/tree/branch/path/to/dir
    # GitLab URLs like: https://gitlab.com/user/repo/-/tree/branch/path/to/dir

    subdirectory = None
    actual_git_url = git_url

    # Check for GitHub tree/blob URL pattern
    # Matches both /tree/ (directory) and /blob/ (file path - but treat as directory)
    github_match = re.match(r'(https://github\.com/[^/]+/[^/]+)(?:/tree|/blob)/[^/]+(?:/(.+))?', git_url)
    if github_match:
        actual_git_url = github_match.group(1) + '.git'
        subdirectory = github_match.group(2).rstrip('/') if github_match.group(2) else None
    else:
        # Strip GitHub web UI paths that are not valid for cloning
        # e.g., /branches, /commits, /pulls, /issues, /settings, /actions, /wiki, /security, /releases, /tags
        github_ui_match = re.match(
            r'(https://github\.com/[^/]+/[^/]+)(?:/(?:branches|commits|pulls?|issues?|settings|actions|wiki|security|releases|tags|projects|graphs?|network)(?:/.*)?)?$',
            git_url
        )
        if github_ui_match:
            actual_git_url = github_ui_match.group(1) + '.git'

    # Check for GitLab tree URL pattern
    gitlab_match = re.match(r'(https://gitlab\.com/[^/]+/[^/]+)/-/tree/[^/]+/(.+)', git_url)
    if gitlab_match:
        actual_git_url = gitlab_match.group(1) + '.git'
        subdirectory = gitlab_match.group(2).rstrip('/')
    else:
        # Strip GitLab web UI paths
        gitlab_ui_match = re.match(
            r'(https://gitlab\.com/[^/]+/[^/]+)(?:/-/(?:branches|commits|merge_requests|issues|settings|pipelines|jobs|releases|tags)(?:/.*)?)?$',
            git_url
        )
        if gitlab_ui_match:
            actual_git_url = gitlab_ui_match.group(1) + '.git'

    # Create a unique directory name based on the Git URL
    url_hash = hashlib.md5(git_url.encode()).hexdigest()[:12]

    # Create cache directory (configurable via GIT_REPOS_PATH env var)
    cache_dir = get_git_repos_path()
    cache_dir.mkdir(parents=True, exist_ok=True)

    # Extract repo name from URL for readability
    repo_name = actual_git_url.rstrip('/').split('/')[-1].replace('.git', '')
    clone_path = cache_dir / f"{repo_name}-{url_hash}"

    # Determine the final project path (with subdirectory if specified)
    final_project_path = clone_path / subdirectory if subdirectory else clone_path

    # If already cloned, pull latest changes
    if clone_path.exists():
        try:
            # Pull latest changes
            result = run_git_command(['pull'], clone_path, clone_path, timeout=60)
            if not result.success:
                # If pull fails, remove and re-clone
                shutil.rmtree(clone_path)
            else:
                # Pull succeeded, return cached path
                return {
                    "valid": True,
                    "path": str(clone_path),  # Return git root, not subdirectory
                    "subdirectory": subdirectory or "",
                    "name": final_project_path.name,
                    "cached": True
                }
        except HTTPException:
            raise
        except Exception as e:
            print(f"Error pulling repository: {e}")
            # If anything goes wrong, remove and re-clone
            if clone_path.exists():
                shutil.rmtree(clone_path)

    # Clone the repository
    try:
        env = os.environ.copy()

        # Check for stored credentials (use clone_path as key since that's where they're stored)
        stored_username = get_stored_username_from_cookie(http_request, str(clone_path))

        # If use_stored is set, get full credentials from cookie
        if git_repo.use_stored:
            stored_creds = get_git_credentials_from_cookie(http_request, str(clone_path))
            if stored_creds:
                username = stored_creds.get("username", "")
                password = stored_creds.get("password", "")

        # If credentials available and using HTTPS, use GIT_ASKPASS for secure credential passing
        if username and password and actual_git_url.startswith("https://"):
            with git_askpass_env(username, password, env) as askpass_env:
                result = run_command(
                    ['git', 'clone', actual_git_url, str(clone_path)],
                    cache_dir,
                    timeout=120,
                    env=askpass_env
                )
        else:
            result = run_command(['git', 'clone', actual_git_url, str(clone_path)], cache_dir, timeout=120, env=env)

        if not result.success:
            error_msg = result.error or ""
            # Sanitize error message to remove any credentials that might be in URLs
            sanitized_error = re.sub(r'https://[^:]+:[^@]+@', 'https://***:***@', error_msg)
            # Check for authentication errors
            if "could not read Username" in error_msg or "Authentication failed" in error_msg or "Invalid username or password" in error_msg or "terminal prompts disabled" in error_msg:
                if actual_git_url.startswith("https://"):
                    raise HTTPException(
                        status_code=401,
                        detail={"code": "AUTH_REQUIRED", "stored_username": stored_username}
                    )
                raise HTTPException(status_code=401, detail="Authentication failed. Check your SSH keys or credentials.")
            raise HTTPException(
                status_code=400,
                detail=f"Failed to clone repository: {sanitized_error}"
            )

        # Save credentials to cookie on success (if flag is set and credentials were provided)
        if git_repo.save_credentials and username and password and actual_git_url.startswith("https://"):
            set_git_credentials_cookie(response, str(clone_path), username, password)

        return {
            "valid": True,
            "path": str(clone_path),  # Return git root, not subdirectory
            "subdirectory": subdirectory or "",
            "name": final_project_path.name,
            "cached": False
        }

    except subprocess.TimeoutExpired:
        raise HTTPException(
            status_code=408,
            detail="Clone operation timed out. Repository may be too large or network is slow."
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error cloning repository: {str(e)}"
        )


@router.post("/api/git-modified-files")
async def get_git_modified_files(project_path: ProjectPath):
    """Get git file status including modified, deleted, and untracked files."""
    path = Path(project_path.path).expanduser().resolve()

    if not path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    git_status = get_git_file_status(path)

    # Combine modified and untracked for sidebar indicators (backward compatible)
    modified_files = list(set(git_status.modified + git_status.untracked))

    return {
        "modified_files": modified_files,
        "modified": sorted(git_status.modified),
        "deleted": sorted(git_status.deleted),
        "untracked": sorted(git_status.untracked),
    }


@router.post("/api/git-is-tracked")
async def git_is_tracked(request: GitTrackedRequest):
    """Check if a file or folder contains git-tracked content."""
    project_path = Path(request.path).expanduser().resolve()

    print(f"[git-is-tracked] Request: path={request.path}, file_path={request.file_path}")
    print(f"[git-is-tracked] Resolved project_path: {project_path}")

    if not project_path.exists():
        print(f"[git-is-tracked] Project path does not exist")
        return {"tracked": False}

    try:
        # Check if this is a git repository
        git_check = run_git_command(['rev-parse', '--git-dir'], project_path, timeout=5)
        if not git_check.success:
            # Not a git repository - consider all files as "new"
            print(f"[git-is-tracked] Not a git repository")
            return {"tracked": False}

        # Get git root to properly resolve paths
        git_root_result = run_git_command(['rev-parse', '--show-toplevel'], project_path, timeout=5)
        git_root = Path(git_root_result.stdout.strip()) if git_root_result.success else project_path
        print(f"[git-is-tracked] Git root: {git_root}")

        # Calculate relative path from git root
        try:
            relative_to_git_root = project_path.relative_to(git_root)
            print(f"[git-is-tracked] relative_to_git_root: {relative_to_git_root}")
            if relative_to_git_root != Path("."):
                git_file_path = str(relative_to_git_root / request.file_path)
            else:
                git_file_path = request.file_path
        except ValueError:
            print(f"[git-is-tracked] ValueError when computing relative path")
            git_file_path = request.file_path

        print(f"[git-is-tracked] git_file_path: {git_file_path}")

        # Check if file_path is a directory (for folders, check if any files inside are tracked)
        full_path = project_path / request.file_path
        if full_path.is_dir():
            # For directories, check if any files inside are tracked
            # Use git ls-files with the directory path followed by /
            result = run_git_command(['ls-files', '--', f"{git_file_path}/"], project_path, git_root, timeout=5)
            output = result.stdout.strip()
            is_tracked = len(output) > 0
            print(f"[git-is-tracked] Directory check: ls-files '{git_file_path}/' output length: {len(output)}, Tracked: {is_tracked}")
        else:
            # Use git ls-files to check if file is tracked in the index
            # This properly handles ignored files (they won't be listed)
            result = run_git_command(['ls-files', '--', git_file_path], project_path, git_root, timeout=5)
            output = result.stdout.strip()
            # If the file is listed, it's tracked
            is_tracked = len(output) > 0
            print(f"[git-is-tracked] File check: ls-files '{git_file_path}' output: '{output}', Tracked: {is_tracked}")

        return {"tracked": is_tracked}

    except Exception as e:
        print(f"[git-is-tracked] Error: {e}")
        return {"tracked": False}


@router.post("/api/restore-file")
async def restore_file(request: RestoreFileRequest):
    """Restore a deleted file from git HEAD."""
    project_path = Path(request.path).expanduser().resolve()

    if not project_path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    try:
        # Get the git repository root
        git_root_result = run_git_command(['rev-parse', '--show-toplevel'], project_path, timeout=5)
        if not git_root_result.success:
            raise HTTPException(status_code=400, detail="Not a git repository")

        git_root = Path(git_root_result.stdout.strip())

        # Calculate the relative path from git root to project path
        try:
            relative_to_git_root = project_path.relative_to(git_root)
        except ValueError:
            relative_to_git_root = Path(".")

        # Build the full path relative to git root
        if relative_to_git_root != Path("."):
            git_file_path = str(relative_to_git_root / request.file_path)
        else:
            git_file_path = request.file_path

        print(f"[restore-file] Git root: {git_root}, file_path: {git_file_path}")

        # Use git checkout to restore the file from HEAD
        result = run_git_command(['checkout', 'HEAD', '--', git_file_path], project_path, git_root, timeout=10)
        if not result.success:
            raise HTTPException(status_code=500, detail=f"Failed to restore file: {result.stderr}")

        print(f"[restore-file] Restored: {git_file_path}")
        return {"success": True, "file_path": request.file_path}

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Git operation timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error restoring file: {str(e)}")


def sanitize_branch_name(name: str) -> str:
    """Sanitize a string to be a valid git branch name."""
    # Replace spaces and special chars with hyphens
    sanitized = re.sub(r'[^a-zA-Z0-9._-]', '-', name.lower())
    # Remove consecutive hyphens
    sanitized = re.sub(r'-+', '-', sanitized)
    # Remove leading/trailing hyphens
    sanitized = sanitized.strip('-')
    return sanitized or 'user'


@router.post("/api/setup-worktree")
async def setup_worktree(request: SetupWorktreeRequest):
    """Create a user branch and worktree for isolated work.

    Creates a branch named '<user_name>-main' and adds a locked worktree for the user.
    The worktree path will be returned for the frontend to use.
    """
    # Validate user inputs for security
    user_name = validate_git_user_name(request.user_name)
    user_email = validate_git_user_email(request.user_email)

    repo_path = Path(request.path).expanduser().resolve()

    if not repo_path.exists():
        raise HTTPException(status_code=404, detail="Repository path does not exist")

    try:
        # Get the git repository root
        git_root_result = run_git_command(['rev-parse', '--show-toplevel'], repo_path, timeout=5)
        if not git_root_result.success:
            raise HTTPException(status_code=400, detail="Not a git repository")

        git_root = Path(git_root_result.stdout.strip())

        # Create sanitized branch name (already uses sanitize_branch_name which is safe)
        sanitized_name = sanitize_branch_name(user_name)
        branch_name = f"{sanitized_name}-main"

        # Check if branch already exists
        branch_check = run_git_command(['branch', '--list', branch_name], git_root, git_root, timeout=5)
        branch_exists = bool(branch_check.stdout.strip())

        if not branch_exists:
            # Create the user branch from current HEAD
            result = run_git_command(['branch', branch_name], git_root, git_root, timeout=10)
            if not result.success:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to create branch: {result.stderr}"
                )

            print(f"[setup-worktree] Created branch: {branch_name}")
        else:
            print(f"[setup-worktree] Branch already exists: {branch_name}")

        # Determine worktree path
        worktrees_dir = git_root.parent / "worktrees"
        worktrees_dir.mkdir(parents=True, exist_ok=True)
        worktree_path = worktrees_dir / f"{git_root.name}-{sanitized_name}"

        # Check if worktree already exists
        worktree_list = run_git_command(['worktree', 'list', '--porcelain'], git_root, git_root, timeout=10)
        worktree_in_git = str(worktree_path) in worktree_list.stdout
        worktree_dir_exists = worktree_path.exists()

        # Handle stale worktree entry (in git list but directory doesn't exist)
        if worktree_in_git and not worktree_dir_exists:
            print(f"[setup-worktree] Removing stale worktree entry: {worktree_path}")
            # Remove the stale worktree entry from git (--force to remove even if locked)
            run_git_command(['worktree', 'remove', '--force', str(worktree_path)], git_root, git_root, timeout=10)
            worktree_in_git = False

        # Handle orphaned directory (directory exists but git doesn't know about it)
        if not worktree_in_git and worktree_dir_exists:
            print(f"[setup-worktree] Removing orphaned worktree directory: {worktree_path}")
            shutil.rmtree(worktree_path)
            worktree_dir_exists = False

        if not worktree_in_git:
            # Add locked worktree
            result = run_git_command(['worktree', 'add', '--lock', str(worktree_path), branch_name], git_root, git_root, timeout=30)
            if not result.success:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to create worktree: {result.stderr}"
                )

            print(f"[setup-worktree] Created locked worktree: {worktree_path}")
        else:
            print(f"[setup-worktree] Worktree already exists: {worktree_path}")

        # Configure git user.name and user.email for this worktree (using validated values)
        run_git_command(['config', 'user.name', user_name], worktree_path, worktree_path, timeout=5)
        run_git_command(['config', 'user.email', user_email], worktree_path, worktree_path, timeout=5)

        print(f"[setup-worktree] Configured git user: {user_name} <{user_email}>")

        # If a subdirectory was specified, return the path including it
        final_path = worktree_path / request.subdirectory if request.subdirectory else worktree_path

        return {
            "success": True,
            "branch": branch_name,
            "worktree_path": str(final_path),
            "created_branch": not branch_exists,
            "created_worktree": not worktree_in_git,
        }

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Git operation timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error setting up worktree: {str(e)}")


@router.post("/api/git-branch")
async def get_git_branch(project_path: ProjectPath):
    """Get the current git branch name for a project path."""
    path = Path(project_path.path).expanduser().resolve()

    if not path.exists():
        return {"branch": ""}

    try:
        # Get current branch name
        result = run_git_command(['rev-parse', '--abbrev-ref', 'HEAD'], path, timeout=5)
        if result.success:
            return {"branch": result.stdout.strip()}
        return {"branch": ""}

    except Exception as e:
        print(f"[git-branch] Error: {e}")
        return {"branch": ""}


@router.post("/api/git-stage")
async def git_stage_files(request: GitStageRequest):
    """Stage files for commit."""
    path = Path(request.path).expanduser().resolve()

    if not path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    # Validate all file paths for security
    validated_files = []
    for fp in request.files:
        validated_files.append(validate_file_path(fp, "file path"))

    try:
        # Get git root
        git_root_result = run_git_command(['rev-parse', '--show-toplevel'], path, timeout=5)
        if not git_root_result.success:
            raise HTTPException(status_code=400, detail="Not a git repository")

        git_root = Path(git_root_result.stdout.strip())

        # Calculate relative path from git root to project path
        try:
            relative_to_git_root = path.relative_to(git_root)
        except ValueError:
            relative_to_git_root = Path(".")

        # Stage each file (using validated paths)
        staged_files = []
        for file_path in validated_files:
            # Build full path relative to git root
            if relative_to_git_root != Path("."):
                git_file_path = str(relative_to_git_root / file_path)
            else:
                git_file_path = file_path

            result = run_git_command(['add', git_file_path], path, git_root, timeout=10)
            if result.success:
                staged_files.append(file_path)
            else:
                print(f"[git-stage] Failed to stage {file_path}: {result.stderr}")

        return {
            "success": True,
            "staged_files": staged_files,
            "failed_count": len(request.files) - len(staged_files)
        }

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Git operation timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error staging files: {str(e)}")


@router.post("/api/git-unstage")
async def git_unstage_files(request: GitStageRequest):
    """Unstage files from the staging area."""
    path = Path(request.path).expanduser().resolve()

    if not path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    # Validate all file paths for security
    validated_files = []
    for fp in request.files:
        validated_files.append(validate_file_path(fp, "file path"))

    try:
        # Get git root
        git_root_result = run_git_command(['rev-parse', '--show-toplevel'], path, timeout=5)
        if not git_root_result.success:
            raise HTTPException(status_code=400, detail="Not a git repository")

        git_root = Path(git_root_result.stdout.strip())

        # Calculate relative path from git root to project path
        try:
            relative_to_git_root = path.relative_to(git_root)
        except ValueError:
            relative_to_git_root = Path(".")

        # Unstage each file (using validated paths)
        unstaged_files = []
        for file_path in validated_files:
            # Build full path relative to git root
            if relative_to_git_root != Path("."):
                git_file_path = str(relative_to_git_root / file_path)
            else:
                git_file_path = file_path

            result = run_git_command(['reset', 'HEAD', '--', git_file_path], path, git_root, timeout=10)
            if result.success:
                unstaged_files.append(file_path)
            else:
                print(f"[git-unstage] Failed to unstage {file_path}: {result.stderr}")

        return {
            "success": True,
            "unstaged_files": unstaged_files,
            "failed_count": len(request.files) - len(unstaged_files)
        }

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Git operation timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error unstaging files: {str(e)}")


@router.post("/api/git-staged-files")
async def git_get_staged_files(request: GitStagedFilesRequest):
    """Get list of currently staged files."""
    path = Path(request.path).expanduser().resolve()

    if not path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    try:
        # Get git root
        git_root_result = run_git_command(['rev-parse', '--show-toplevel'], path, timeout=5)
        if not git_root_result.success:
            return {"staged": []}

        git_root = Path(git_root_result.stdout.strip())

        # Calculate relative path from git root to project path
        try:
            relative_to_git_root = path.relative_to(git_root)
        except ValueError:
            relative_to_git_root = Path(".")

        prefix = str(relative_to_git_root) + "/" if relative_to_git_root != Path(".") else ""

        # Get staged files
        result = run_git_command(['diff', '--cached', '--name-only'], path, git_root, timeout=10)

        staged = []
        if result.success and result.stdout:
            all_staged = [f.strip() for f in result.stdout.split('\n') if f.strip()]
            # Filter to project subdirectory and strip prefix
            if prefix:
                staged = [f[len(prefix):] for f in all_staged if f.startswith(prefix)]
            else:
                staged = all_staged

        return {"staged": sorted(staged)}

    except Exception as e:
        print(f"[git-staged-files] Error: {e}")
        return {"staged": []}


@router.post("/api/git-commit")
async def git_commit(request: GitCommitRequest):
    """Create a git commit with the staged files."""
    # Validate all inputs for security
    user_name = validate_git_user_name(request.user_name)
    user_email = validate_git_user_email(request.user_email)
    message = validate_commit_message(request.message)

    path = Path(request.path).expanduser().resolve()

    if not path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    try:
        # Get git root
        git_root_result = run_git_command(['rev-parse', '--show-toplevel'], path, timeout=5)
        if not git_root_result.success:
            raise HTTPException(status_code=400, detail="Not a git repository")

        git_root = Path(git_root_result.stdout.strip())

        # Set user config for this commit (use -c to set config for this command only)
        # Using validated values to prevent command injection
        result = run_command(
            [
                'git', '-C', str(git_root),
                '-c', f'user.name={user_name}',
                '-c', f'user.email={user_email}',
                'commit', '-m', message
            ],
            path,
            timeout=30
        )

        if not result.success:
            error_msg = result.error
            if "nothing to commit" in error_msg.lower():
                raise HTTPException(status_code=400, detail="Nothing to commit. Stage some files first.")
            raise HTTPException(status_code=500, detail=f"Commit failed: {error_msg}")

        # Get the commit hash
        hash_result = run_git_command(['rev-parse', '--short', 'HEAD'], path, git_root, timeout=5)
        commit_hash = hash_result.stdout.strip() if hash_result.success else ""

        print(f"[git-commit] Created commit {commit_hash}: {message[:50]}...")

        return {
            "success": True,
            "commit_hash": commit_hash,
            "message": message
        }

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Git operation timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating commit: {str(e)}")


@router.post("/api/git-create-branch")
async def git_create_branch(request: GitCreateBranchRequest):
    """Create a new git branch from the latest state of the default branch.

    This endpoint:
    1. Fetches the latest changes from origin for the default branch (main/master)
    2. Creates the new branch from origin/<default_branch>
    3. Optionally checks out the new branch
    """
    path = Path(request.path).expanduser().resolve()

    if not path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    if not request.branch_name.strip():
        raise HTTPException(status_code=400, detail="Branch name cannot be empty")

    # Sanitize branch name
    sanitized = sanitize_branch_name(request.branch_name)
    if not sanitized:
        raise HTTPException(status_code=400, detail="Invalid branch name")

    try:
        # Get git root
        git_root_result = run_git_command(['rev-parse', '--show-toplevel'], path, timeout=5)
        if not git_root_result.success:
            raise HTTPException(status_code=400, detail="Not a git repository")

        git_root = Path(git_root_result.stdout.strip())

        # Check if branch already exists
        branch_check = run_git_command(['branch', '--list', sanitized], path, git_root, timeout=5)
        if branch_check.stdout.strip():
            raise HTTPException(status_code=400, detail=f"Branch '{sanitized}' already exists")

        # Determine the default branch (main or master)
        default_branch = get_default_branch(git_root, path)
        if not default_branch:
            raise HTTPException(status_code=400, detail="Could not determine default branch (main/master)")

        print(f"[git-create-branch] Default branch detected: {default_branch}")

        # Fetch the latest changes from origin for the default branch
        fetch_result = run_git_command(['fetch', 'origin', default_branch], path, git_root, timeout=60)
        if not fetch_result.success:
            print(f"[git-create-branch] Fetch warning: {fetch_result.stderr}")
            # Don't fail if fetch fails - we might be offline or origin might not exist
            # Just continue and create branch from current state

        # Create the branch from origin/<default_branch>
        start_point = f"origin/{default_branch}"

        # Verify the remote branch exists
        remote_check = run_git_command(['rev-parse', '--verify', start_point], path, git_root, timeout=5)
        if not remote_check.success:
            # Fallback to local default branch if remote doesn't exist
            start_point = default_branch
            print(f"[git-create-branch] Remote branch not found, using local {default_branch}")

        if request.checkout:
            # Create and checkout in one command
            result = run_git_command(['checkout', '-b', sanitized, start_point], path, git_root, timeout=10)
        else:
            # Just create the branch
            result = run_git_command(['branch', sanitized, start_point], path, git_root, timeout=10)

        if not result.success:
            raise HTTPException(status_code=500, detail=f"Failed to create branch: {result.stderr}")

        print(f"[git-create-branch] Created branch: {sanitized} from {start_point}, checkout: {request.checkout}")

        return {
            "success": True,
            "branch": sanitized,
            "checked_out": request.checkout,
            "based_on": start_point
        }

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Git operation timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating branch: {str(e)}")


@router.post("/api/git-list-branches")
async def git_list_branches(project_path: ProjectPath):
    """List all git branches."""
    path = Path(project_path.path).expanduser().resolve()

    if not path.exists():
        return {"branches": [], "current": "", "default_branch": "", "worktree_branches": []}

    try:
        # Get git root
        git_root_result = run_git_command(['rev-parse', '--show-toplevel'], path, timeout=5)
        if not git_root_result.success:
            return {"branches": [], "current": "", "default_branch": "", "worktree_branches": []}

        git_root = Path(git_root_result.stdout.strip())

        # Get current branch
        current_result = run_git_command(['rev-parse', '--abbrev-ref', 'HEAD'], path, git_root, timeout=5)
        current_branch = current_result.stdout.strip() if current_result.success else ""

        # Get default branch (usually main or master)
        default_branch = get_default_branch(git_root, path)

        # Get branches checked out in worktrees
        worktree_branches = []
        worktree_result = run_git_command(['worktree', 'list', '--porcelain'], path, git_root, timeout=10)
        if worktree_result.success and worktree_result.stdout:
            # Parse porcelain output to find branches
            current_worktree_path = None
            for line in worktree_result.stdout.split('\n'):
                if line.startswith('worktree '):
                    current_worktree_path = line[9:]
                elif line.startswith('branch '):
                    branch = line[7:].split('/')[-1]  # refs/heads/branch-name -> branch-name
                    # Don't include the branch from the current worktree path
                    if current_worktree_path and str(path).startswith(current_worktree_path):
                        continue
                    worktree_branches.append(branch)

        # List all branches
        result = run_git_command(['branch', '--list', '--format=%(refname:short)'], path, git_root, timeout=10)

        branches = []
        if result.success and result.stdout:
            branches = [b.strip() for b in result.stdout.split('\n') if b.strip()]

        return {
            "branches": sorted(branches),
            "current": current_branch,
            "default_branch": default_branch,
            "worktree_branches": worktree_branches
        }

    except Exception as e:
        print(f"[git-list-branches] Error: {e}")
        return {"branches": [], "current": "", "default_branch": "", "worktree_branches": []}


@router.post("/api/git-checkout-branch")
async def git_checkout_branch(request: GitCreateBranchRequest):
    """Checkout an existing git branch."""
    # Validate branch name for security
    branch_name = validate_git_branch_name(request.branch_name)

    path = Path(request.path).expanduser().resolve()

    if not path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    try:
        # Get git root
        git_root_result = run_git_command(['rev-parse', '--show-toplevel'], path, timeout=5)
        if not git_root_result.success:
            raise HTTPException(status_code=400, detail="Not a git repository")

        git_root = Path(git_root_result.stdout.strip())

        # Checkout the branch (using validated name)
        result = run_git_command(['checkout', branch_name], path, git_root, timeout=10)
        if not result.success:
            raise HTTPException(status_code=500, detail=f"Failed to checkout branch: {result.stderr}")

        print(f"[git-checkout-branch] Checked out: {branch_name}")

        return {
            "success": True,
            "branch": branch_name
        }

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Git operation timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error checking out branch: {str(e)}")


@router.post("/api/git-branch-info")
async def git_branch_info(project_path: ProjectPath):
    """Get info about the current branch including remote tracking status."""
    path = Path(project_path.path).expanduser().resolve()

    if not path.exists():
        return {
            "has_remote": False,
            "ahead": 0,
            "behind": 0,
            "remote_branch": ""
        }

    try:
        # Get git root
        git_root_result = run_git_command(['rev-parse', '--show-toplevel'], path, timeout=5)
        if not git_root_result.success:
            return {"has_remote": False, "ahead": 0, "behind": 0, "remote_branch": ""}

        git_root = Path(git_root_result.stdout.strip())

        # Get current branch
        branch_result = run_git_command(['rev-parse', '--abbrev-ref', 'HEAD'], path, git_root, timeout=5)
        if not branch_result.success:
            return {"has_remote": False, "ahead": 0, "behind": 0, "remote_branch": ""}

        current_branch = branch_result.stdout.strip()

        # Check if branch has upstream
        upstream_result = run_git_command(['rev-parse', '--abbrev-ref', f'{current_branch}@{{upstream}}'], path, git_root, timeout=5)

        has_remote = upstream_result.success
        remote_branch = upstream_result.stdout.strip() if has_remote else ""

        ahead = 0
        behind = 0

        if has_remote:
            # Get ahead/behind counts
            rev_list_result = run_git_command(['rev-list', '--left-right', '--count', f'{current_branch}...{remote_branch}'], path, git_root, timeout=10)

            if rev_list_result.success and rev_list_result.stdout.strip():
                parts = rev_list_result.stdout.strip().split()
                if len(parts) == 2:
                    ahead = int(parts[0])
                    behind = int(parts[1])

        return {
            "has_remote": has_remote,
            "ahead": ahead,
            "behind": behind,
            "remote_branch": remote_branch
        }

    except Exception as e:
        print(f"[git-branch-info] Error: {e}")
        return {"has_remote": False, "ahead": 0, "behind": 0, "remote_branch": ""}


@router.post("/api/git-push")
async def git_push(request: GitPushPullRequest, http_request: Request, response: Response):
    """Push current branch to origin. Creates upstream if it doesn't exist."""
    path = Path(request.path).expanduser().resolve()

    if not path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    try:
        # Get git root
        git_root_result = run_git_command(['rev-parse', '--show-toplevel'], path, timeout=5)
        if not git_root_result.success:
            raise HTTPException(status_code=400, detail="Not a git repository")

        git_root = Path(git_root_result.stdout.strip())

        # Get main repo path for credential lookups (handles worktrees)
        main_repo_path = get_main_repo_path(path, git_root)

        # Get current branch
        branch_result = run_git_command(['rev-parse', '--abbrev-ref', 'HEAD'], path, git_root, timeout=5)
        if not branch_result.success:
            raise HTTPException(status_code=400, detail="Could not determine current branch")

        current_branch = branch_result.stdout.strip()

        # Check remote URL to provide better error messages
        remote_url_result = run_git_command(['remote', 'get-url', 'origin'], path, git_root, timeout=5)
        remote_url = remote_url_result.stdout.strip() if remote_url_result.success else ""

        # Build environment with credentials if provided
        env = os.environ.copy()

        # Get credentials - either from request or stored (if use_stored is true)
        username = request.username
        password = request.password

        if request.use_stored:
            # User explicitly requested to use stored credentials
            stored_creds = get_git_credentials_from_cookie(http_request, main_repo_path)
            if stored_creds:
                username = stored_creds.get("username", "")
                password = stored_creds.get("password", "")

        # For HTTPS repos, require credentials (either provided or stored via use_stored)
        # If no credentials, return AUTH_REQUIRED with stored username for pre-fill
        if remote_url.startswith("https://") and (not username or not password):
            stored_username = get_stored_username_from_cookie(http_request, main_repo_path)
            raise HTTPException(
                status_code=401,
                detail={"code": "AUTH_REQUIRED", "stored_username": stored_username}
            )

        # If credentials available and using HTTPS, use GIT_ASKPASS for secure credential passing
        # This avoids exposing credentials in CLI arguments (visible in ps, logs, /proc)
        if username and password and remote_url.startswith("https://"):
            with git_askpass_env(username, password, env) as askpass_env:
                result = run_git_command(
                    ['push', '-u', 'origin', current_branch],
                    path,
                    git_root,
                    timeout=120,
                    env=askpass_env
                )
        else:
            # Push without credentials (SSH or local)
            result = run_git_command(
                ['push', '-u', 'origin', current_branch],
                path,
                git_root,
                timeout=120,
                env=env
            )

        if not result.success:
            error_msg = result.error
            # Sanitize error message to remove any credentials that might be in URLs
            sanitized_error = re.sub(r'https://[^:]+:[^@]+@', 'https://***:***@', error_msg)
            # Check for authentication errors
            if "could not read Username" in error_msg or "Authentication failed" in error_msg or "Invalid username or password" in error_msg:
                if remote_url.startswith("https://"):
                    stored_username = get_stored_username_from_cookie(http_request, main_repo_path)
                    raise HTTPException(
                        status_code=401,
                        detail={"code": "AUTH_REQUIRED", "stored_username": stored_username}
                    )
                raise HTTPException(status_code=401, detail="Authentication failed. Check your SSH keys or credentials.")
            raise HTTPException(status_code=500, detail=f"Push failed: {sanitized_error}")

        print(f"[git-push] Pushed branch: {current_branch}")

        # Save credentials to cookie on success (if flag is set and credentials were provided)
        if request.save_credentials and username and password and remote_url.startswith("https://"):
            set_git_credentials_cookie(response, main_repo_path, username, password)

        return {
            "success": True,
            "branch": current_branch
        }

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Push operation timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error pushing: {str(e)}")


@router.post("/api/git-pull")
async def git_pull(request: GitPushPullRequest, http_request: Request, response: Response):
    """Pull changes from upstream for the current branch."""
    path = Path(request.path).expanduser().resolve()

    if not path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    try:
        # Get git root
        git_root_result = run_git_command(['rev-parse', '--show-toplevel'], path, timeout=5)
        if not git_root_result.success:
            raise HTTPException(status_code=400, detail="Not a git repository")

        git_root = Path(git_root_result.stdout.strip())

        # Get main repo path for credential lookups (handles worktrees)
        main_repo_path = get_main_repo_path(path, git_root)

        # Get current branch
        branch_result = run_git_command(['rev-parse', '--abbrev-ref', 'HEAD'], path, git_root, timeout=5)
        if not branch_result.success:
            raise HTTPException(status_code=400, detail="Could not determine current branch")

        current_branch = branch_result.stdout.strip()

        # Check if branch has upstream
        upstream_result = run_git_command(['rev-parse', '--abbrev-ref', f'{current_branch}@{{upstream}}'], path, git_root, timeout=5)
        if not upstream_result.success:
            raise HTTPException(status_code=400, detail="Branch has no upstream tracking branch")

        # Check remote URL
        remote_url_result = run_git_command(['remote', 'get-url', 'origin'], path, git_root, timeout=5)
        remote_url = remote_url_result.stdout.strip() if remote_url_result.success else ""

        env = os.environ.copy()

        # Get credentials - either from request or stored (if use_stored is true)
        username = request.username
        password = request.password

        if request.use_stored:
            # User explicitly requested to use stored credentials
            stored_creds = get_git_credentials_from_cookie(http_request, main_repo_path)
            if stored_creds:
                username = stored_creds.get("username", "")
                password = stored_creds.get("password", "")

        # For HTTPS repos, require credentials (either provided or stored via use_stored)
        # If no credentials, return AUTH_REQUIRED with stored username for pre-fill
        if remote_url.startswith("https://") and (not username or not password):
            stored_username = get_stored_username_from_cookie(http_request, main_repo_path)
            raise HTTPException(
                status_code=401,
                detail={"code": "AUTH_REQUIRED", "stored_username": stored_username}
            )

        # If credentials available and using HTTPS, use GIT_ASKPASS for secure credential passing
        # This avoids exposing credentials in CLI arguments (visible in ps, logs, /proc)
        if username and password and remote_url.startswith("https://"):
            with git_askpass_env(username, password, env) as askpass_env:
                result = run_git_command(
                    ['pull'],
                    path,
                    git_root,
                    timeout=120,
                    env=askpass_env
                )
        else:
            # Pull without credentials (SSH or local)
            result = run_git_command(
                ['pull'],
                path,
                git_root,
                timeout=120,
                env=env
            )

        if not result.success:
            error_msg = result.error
            # Sanitize error message to remove any credentials that might be in URLs
            sanitized_error = re.sub(r'https://[^:]+:[^@]+@', 'https://***:***@', error_msg)
            # Check for authentication errors
            if "could not read Username" in error_msg or "Authentication failed" in error_msg or "Invalid username or password" in error_msg:
                if remote_url.startswith("https://"):
                    stored_username = get_stored_username_from_cookie(http_request, main_repo_path)
                    raise HTTPException(
                        status_code=401,
                        detail={"code": "AUTH_REQUIRED", "stored_username": stored_username}
                    )
                raise HTTPException(status_code=401, detail="Authentication failed. Check your SSH keys or credentials.")
            raise HTTPException(status_code=500, detail=f"Pull failed: {sanitized_error}")

        print(f"[git-pull] Pulled branch: {current_branch}")

        # Save credentials to cookie on success (if flag is set and credentials were provided)
        if request.save_credentials and username and password and remote_url.startswith("https://"):
            set_git_credentials_cookie(response, main_repo_path, username, password)

        return {
            "success": True,
            "branch": current_branch,
            "output": result.stdout
        }

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Pull operation timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error pulling: {str(e)}")


@router.post("/api/git-delete-branch")
async def git_delete_branch(request: GitCreateBranchRequest):
    """Delete a git branch."""
    # Validate branch name for security
    branch_name = validate_git_branch_name(request.branch_name)

    path = Path(request.path).expanduser().resolve()

    if not path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    try:
        # Get git root
        git_root_result = run_git_command(['rev-parse', '--show-toplevel'], path, timeout=5)
        if not git_root_result.success:
            raise HTTPException(status_code=400, detail="Not a git repository")

        git_root = Path(git_root_result.stdout.strip())

        # Get current branch
        current_result = run_git_command(['rev-parse', '--abbrev-ref', 'HEAD'], path, git_root, timeout=5)
        current_branch = current_result.stdout.strip() if current_result.success else ""

        # Cannot delete the current branch
        if branch_name == current_branch:
            raise HTTPException(status_code=400, detail="Cannot delete the currently checked out branch")

        # Get default branch
        default_branch = get_default_branch(git_root, path)

        # Cannot delete the default branch
        if branch_name == default_branch:
            raise HTTPException(status_code=400, detail="Cannot delete the default branch")

        # Check if branch is checked out in a worktree
        worktree_result = run_git_command(['worktree', 'list', '--porcelain'], path, git_root, timeout=10)

        if worktree_result.success and worktree_result.stdout:
            current_worktree_path = None
            for line in worktree_result.stdout.split('\n'):
                if line.startswith('worktree '):
                    current_worktree_path = line[9:]
                elif line.startswith('branch '):
                    branch = line[7:].split('/')[-1]
                    if branch == branch_name:
                        # Check if this is the current worktree
                        if current_worktree_path and str(path).startswith(current_worktree_path):
                            continue
                        raise HTTPException(
                            status_code=400,
                            detail=f"Cannot delete branch '{branch_name}': checked out in another worktree"
                        )

        # Delete the branch (use -D to force delete even if not merged)
        result = run_git_command(['branch', '-D', branch_name], path, git_root, timeout=10)
        if not result.success:
            raise HTTPException(status_code=500, detail=f"Failed to delete branch: {result.stderr}")

        # Try to delete remote branch as well
        remote_delete_result = run_git_command(['push', 'origin', '--delete', branch_name], path, git_root, timeout=30)
        remote_deleted = remote_delete_result.success

        print(f"[git-delete-branch] Deleted branch: {branch_name}, remote_deleted: {remote_deleted}")

        return {
            "success": True,
            "branch": branch_name,
            "remote_deleted": remote_deleted
        }

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Git operation timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting branch: {str(e)}")
