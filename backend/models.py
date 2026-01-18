"""Pydantic models for API request/response schemas."""
from pydantic import BaseModel
from typing import List, Optional, Dict


class ProjectPath(BaseModel):
    path: str


class FileNode(BaseModel):
    name: str
    type: str  # 'file' or 'directory'
    path: str
    children: Optional[List['FileNode']] = None
    deleted: bool = False  # True if file was deleted but exists in git
    hasChildren: bool = False  # True if directory has children (for lazy loading)


class ListDirectoryRequest(BaseModel):
    path: str  # Project path
    subPath: str = ""  # Relative path within project to list (empty = root)


class FileContent(BaseModel):
    path: str
    content: str


class GitRepoUrl(BaseModel):
    git_url: str
    username: str = ""  # Git username for HTTPS auth (optional)
    password: str = ""  # Git password/token for HTTPS auth (optional)
    save_credentials: bool = True  # Whether to save credentials in cookie for future use
    use_stored: bool = False  # If true, use stored credentials from cookie


class DbtCommandRequest(BaseModel):
    """Unified request model for all dbt commands (compile, run, test, seed)."""
    path: str
    command: str = ""  # One of: compile, run, test, seed
    selector: str = ""  # Optional: dbt selector/model name
    target: str = ""  # Optional: dbt target to use
    full_refresh: bool = False  # Optional: run with --full-refresh flag


class DbtLsRequest(BaseModel):
    path: str
    selector: str = ""


class DbtShowRequest(BaseModel):
    path: str
    model: str
    limit: int = 10


class GitTrackedRequest(BaseModel):
    path: str
    file_path: str


class RestoreFileRequest(BaseModel):
    path: str
    file_path: str


class CreateFileRequest(BaseModel):
    path: str
    folder: str = ""  # Optional folder path relative to project root


class RenameFileRequest(BaseModel):
    path: str
    old_path: str
    new_path: str


class DeleteFileRequest(BaseModel):
    path: str
    file_path: str


class EnvVarsRequest(BaseModel):
    path: str


class SetEnvVarsRequest(BaseModel):
    path: str
    env_vars: Dict[str, str]


class SetupWorktreeRequest(BaseModel):
    path: str  # Path to the git repository (clone path, may include subdirectory)
    user_name: str  # Git user.name for the worktree
    user_email: str  # Git user.email for the worktree
    subdirectory: str = ""  # Optional subdirectory within the repo to use as project root


class GitStageRequest(BaseModel):
    path: str  # Project path (worktree)
    files: List[str]  # List of file paths to stage (relative to project)


class GitCommitRequest(BaseModel):
    path: str  # Project path (worktree)
    message: str  # Commit message
    user_name: str  # Git user.name
    user_email: str  # Git user.email


class GitCreateBranchRequest(BaseModel):
    path: str  # Project path (worktree)
    branch_name: str  # Name for the new branch
    checkout: bool = True  # Whether to checkout the new branch


class GitStagedFilesRequest(BaseModel):
    path: str  # Project path (worktree)


class GitPushPullRequest(BaseModel):
    path: str  # Project path (worktree)
    username: str = ""  # Git username for HTTPS auth (optional)
    password: str = ""  # Git password/token for HTTPS auth (optional)
    save_credentials: bool = True  # Whether to save credentials in cookie for future use
    use_stored: bool = False  # If true, use stored credentials from cookie
