"""File operation API routes."""
from fastapi import APIRouter, HTTPException
from pathlib import Path
import shutil

from models import (
    ProjectPath, FileNode, FileContent, ListDirectoryRequest,
    CreateFileRequest, RenameFileRequest, DeleteFileRequest
)
from routes.git_routes import get_git_file_status, get_git_repos_path
from utils.merge_utils import simple_merge
from utils.input_validation import validate_file_path

router = APIRouter()


@router.get("/api/default-project-path")
async def get_default_project_path():
    """Get the default project path (GitHub URL to sample dbt project)."""
    return {"path": ""}


@router.post("/api/validate-path")
async def validate_path(project_path: ProjectPath):
    """Validate if the given path exists and is a dbt project."""
    path = Path(project_path.path).expanduser().resolve()

    if not path.exists():
        raise HTTPException(status_code=404, detail="Path does not exist")

    if not path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    # Check for dbt_project.yml
    dbt_project_file = path / "dbt_project.yml"
    if not dbt_project_file.exists():
        raise HTTPException(
            status_code=400,
            detail="Not a valid dbt project (dbt_project.yml not found)"
        )

    return {
        "valid": True,
        "path": str(path),
        "name": path.name
    }


@router.post("/api/list-directory-shallow")
async def list_directory_shallow(request: ListDirectoryRequest):
    """List immediate children of a directory (shallow, for lazy loading)."""
    project_path = Path(request.path).expanduser().resolve()

    if not project_path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    # Determine the target directory
    if request.subPath:
        target_path = project_path / request.subPath
    else:
        target_path = project_path

    if not target_path.exists():
        raise HTTPException(status_code=404, detail="Directory does not exist")

    if not target_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    # Get git file status for deleted files
    git_status = get_git_file_status(project_path)
    deleted_files: set = set(git_status.deleted)

    # Build deleted directories set
    deleted_dirs: set = set()
    for deleted_file in deleted_files:
        parts = deleted_file.split('/')
        for i in range(1, len(parts)):
            dir_path = '/'.join(parts[:i])
            full_dir_path = project_path / dir_path
            if not full_dir_path.exists():
                deleted_dirs.add(dir_path)

    children = []
    existing_names = set()
    current_rel_path = request.subPath

    try:
        items = sorted(target_path.iterdir(), key=lambda x: (not x.is_dir(), x.name))
        for item in items:
            # Skip hidden files and common ignore directories
            if item.name.startswith('.') or item.name in ['__pycache__', 'node_modules']:
                continue

            existing_names.add(item.name)
            rel_path = str(item.relative_to(project_path))

            if item.is_dir():
                # Check if directory has any children (for hasChildren flag)
                has_children = False
                try:
                    for child in item.iterdir():
                        if not child.name.startswith('.') and child.name not in ['__pycache__', 'node_modules']:
                            has_children = True
                            break
                except PermissionError:
                    pass

                children.append(FileNode(
                    name=item.name,
                    type="directory",
                    path=rel_path,
                    children=None,  # Not loaded yet
                    hasChildren=has_children
                ))
            else:
                children.append(FileNode(
                    name=item.name,
                    type="file",
                    path=rel_path,
                    children=None,
                    hasChildren=False
                ))
    except PermissionError:
        pass

    # Add deleted directories that belong to this directory
    for deleted_dir in deleted_dirs:
        if '/' in deleted_dir:
            parent_dir = '/'.join(deleted_dir.split('/')[:-1])
            dir_name = deleted_dir.split('/')[-1]
        else:
            parent_dir = ""
            dir_name = deleted_dir

        if parent_dir == current_rel_path and dir_name not in existing_names:
            children.append(FileNode(
                name=dir_name,
                type="directory",
                path=deleted_dir,
                children=None,
                deleted=True,
                hasChildren=True  # Assume deleted dirs have children
            ))
            existing_names.add(dir_name)

    # Add deleted files that belong to this directory
    for deleted_file in deleted_files:
        if '/' in deleted_file:
            file_dir = '/'.join(deleted_file.split('/')[:-1])
            file_name = deleted_file.split('/')[-1]
        else:
            file_dir = ""
            file_name = deleted_file

        if file_dir == current_rel_path and file_name not in existing_names:
            children.append(FileNode(
                name=file_name,
                type="file",
                path=deleted_file,
                children=None,
                deleted=True,
                hasChildren=False
            ))

    # Sort: directories first, then by name
    children.sort(key=lambda x: (x.type != "directory", x.name))

    return {"children": children}


@router.post("/api/read-file")
async def read_file(file_data: dict):
    """Read the contents of a file."""
    project_path = Path(file_data['projectPath']).expanduser().resolve()
    file_path = project_path / file_data['filePath']

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File does not exist")

    if not file_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    # Check if file is within project directory (security)
    try:
        file_path.resolve().relative_to(project_path.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied: File outside project directory")

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        return FileContent(
            path=str(file_path.relative_to(project_path)),
            content=content
        )
    except UnicodeDecodeError:
        # Return a graceful response for binary files instead of error
        return {
            "path": str(file_path.relative_to(project_path)),
            "content": None,
            "isBinary": True,
            "error": "Cannot display binary file"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading file: {str(e)}")


@router.post("/api/write-file")
async def write_file(file_data: dict):
    """Write content to a file with conflict detection and three-way merge."""
    project_path = Path(file_data['projectPath']).expanduser().resolve()
    file_path = project_path / file_data['filePath']
    content = file_data['content']
    original_content = file_data.get('originalContent')  # Content when file was loaded

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File does not exist")

    if not file_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    # Check if file is within project directory (security)
    try:
        file_path.resolve().relative_to(project_path.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied: File outside project directory")

    try:
        # Read current disk content
        with open(file_path, 'r', encoding='utf-8') as f:
            disk_content = f.read()

        merged_content = content
        was_merged = False
        has_conflicts = False

        # If original content provided, check for conflicts
        if original_content is not None:
            if disk_content != original_content:
                # File was modified by someone else since we loaded it
                # Perform three-way merge
                merged_content, was_merged = simple_merge(original_content, content, disk_content)
                # Check if the merge result contains conflict markers
                has_conflicts = '<<<<<<< YOUR CHANGES' in merged_content

                # If there are conflicts, don't write yet - let user decide
                if has_conflicts:
                    return {
                        "success": True,
                        "path": str(file_path.relative_to(project_path)),
                        "merged": True,
                        "hasConflicts": True,
                        "content": merged_content,  # Merged content with conflict markers
                        "diskContent": disk_content  # Current disk content for "Accept My Changes"
                    }

        # Write the (potentially merged) content - only if no conflicts
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(merged_content)

        return {
            "success": True,
            "path": str(file_path.relative_to(project_path)),
            "merged": was_merged,
            "hasConflicts": False,
            "content": merged_content if was_merged else None  # Return merged content for frontend update
        }
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File is not a text file")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error writing file: {str(e)}")


@router.post("/api/browse-directories")
async def browse_directories(request: dict):
    """Browse directories within the git-repos path only."""
    # Root path is always git-repos (configurable via GIT_REPOS_PATH env var)
    root_path = get_git_repos_path()
    if not root_path.exists():
        root_path.mkdir(parents=True, exist_ok=True)

    path_str = request.get('path', str(root_path))
    path = Path(path_str).expanduser().resolve()

    # Ensure path is within root_path (prevent navigating outside git-repos)
    try:
        path.relative_to(root_path)
    except ValueError:
        # Path is outside root_path, reset to root
        path = root_path

    if not path.exists():
        path = root_path

    if not path.is_dir():
        path = path.parent

    directories = []

    # Add parent directory option only if not at root_path
    if path != root_path and path.parent != path:
        directories.append({
            "name": "..",
            "path": str(path.parent),
            "isParent": True
        })

    try:
        items = sorted(path.iterdir(), key=lambda x: x.name.lower())
        for item in items:
            # Skip hidden files
            if item.name.startswith('.'):
                continue

            if item.is_dir():
                # Check if it might be a dbt project
                has_dbt_project = (item / "dbt_project.yml").exists()

                directories.append({
                    "name": item.name,
                    "path": str(item),
                    "isParent": False,
                    "isDbtProject": has_dbt_project
                })
    except PermissionError:
        pass

    # Create display path relative to git-repos (e.g., "git-repos/my-project")
    try:
        relative_path = path.relative_to(root_path.parent)
        display_path = str(relative_path)
    except ValueError:
        display_path = "git-repos"

    return {
        "currentPath": str(path),
        "displayPath": display_path,
        "directories": directories
    }


@router.post("/api/create-file")
async def create_file(request: CreateFileRequest):
    """Create a new empty file with unique 'untitled' name."""
    project_path = Path(request.path).expanduser().resolve()

    if not project_path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    # Determine target directory
    if request.folder:
        target_dir = project_path / request.folder
        if not target_dir.exists():
            raise HTTPException(status_code=404, detail="Target folder does not exist")
        if not target_dir.is_dir():
            raise HTTPException(status_code=400, detail="Target path is not a folder")
    else:
        target_dir = project_path

    try:
        # Find unique filename starting with "untitled"
        base_name = "untitled"
        file_path = target_dir / base_name

        if not file_path.exists():
            # Create the file
            file_path.touch()
            relative_path = f"{request.folder}/{base_name}" if request.folder else base_name
            return {"file_path": relative_path, "success": True}

        # File exists, try untitled2, untitled3, etc.
        counter = 2
        while True:
            candidate_name = f"{base_name}{counter}"
            file_path = target_dir / candidate_name

            if not file_path.exists():
                # Create the file
                file_path.touch()
                relative_path = f"{request.folder}/{candidate_name}" if request.folder else candidate_name
                return {"file_path": relative_path, "success": True}

            counter += 1

            # Safety limit to prevent infinite loop
            if counter > 1000:
                raise HTTPException(status_code=500, detail="Unable to generate unique filename")

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating file: {str(e)}")


@router.post("/api/rename-file")
async def rename_file(request: RenameFileRequest):
    """Rename a file or folder in the project."""
    # Validate file paths for security (check for dangerous characters and traversal)
    validated_old_path = validate_file_path(request.old_path, "old path")
    validated_new_path = validate_file_path(request.new_path, "new path")

    project_path = Path(request.path).expanduser().resolve()

    if not project_path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    old_path = project_path / validated_old_path
    new_path = project_path / validated_new_path

    # Check if old path exists
    if not old_path.exists():
        raise HTTPException(status_code=404, detail="Path does not exist")

    # Check if new path already exists
    if new_path.exists():
        raise HTTPException(status_code=400, detail="A file or folder with the new name already exists")

    # Security check: ensure both paths are within project directory
    try:
        old_path.resolve().relative_to(project_path.resolve())
        new_path.resolve().relative_to(project_path.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied: Path outside project directory")

    try:
        # Create parent directories if they don't exist
        new_path.parent.mkdir(parents=True, exist_ok=True)

        # Rename the file or folder
        old_path.rename(new_path)

        return {
            "success": True,
            "old_path": validated_old_path,
            "new_path": validated_new_path
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error renaming: {str(e)}")


@router.post("/api/delete-file")
async def delete_file(request: DeleteFileRequest):
    """Delete a file or folder from the project."""
    # Validate file path for security (check for dangerous characters and traversal)
    validated_file_path = validate_file_path(request.file_path, "file path")

    project_path = Path(request.path).expanduser().resolve()

    if not project_path.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")

    target_path = project_path / validated_file_path

    # Check if path exists
    if not target_path.exists():
        raise HTTPException(status_code=404, detail="Path does not exist")

    # Security check: ensure path is within project directory
    try:
        target_path.resolve().relative_to(project_path.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied: Path outside project directory")

    try:
        if target_path.is_file():
            # Delete the file
            target_path.unlink()
        else:
            # Delete the folder and all its contents
            shutil.rmtree(target_path)

        return {
            "success": True,
            "deleted_path": validated_file_path
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting: {str(e)}")
