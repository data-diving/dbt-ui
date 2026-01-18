"""Input validation utilities for security hardening.

This module provides validation functions to prevent command injection
and other security vulnerabilities when processing user input that will
be used in subprocess commands or file operations.
"""
import re
from fastapi import HTTPException


# Allowed characters for dbt selectors/model names
# dbt selectors can contain: alphanumeric, underscore, dot, colon, plus, minus, star, slash
# Examples: model_name, +model_name, model_name+, @source:name, path/to/model
# Reference: https://docs.getdbt.com/reference/node-selection/syntax
DBT_SELECTOR_PATTERN = re.compile(r'^[a-zA-Z0-9_.:+\-*/,@\s]+$')

# Allowed characters for git branch names (after sanitization)
# Git branch names: alphanumeric, underscore, dot, hyphen, slash
GIT_BRANCH_PATTERN = re.compile(r'^[a-zA-Z0-9_.\-/]+$')

# Allowed characters for git user.name and user.email
# Should not contain shell metacharacters or control characters
GIT_USER_NAME_PATTERN = re.compile(r'^[a-zA-Z0-9_.\-\s\'"]+$')
GIT_USER_EMAIL_PATTERN = re.compile(r'^[a-zA-Z0-9_.\-@+]+$')

# Dangerous characters that should never appear in file paths
# These could be used for command injection or path traversal
DANGEROUS_PATH_CHARS = re.compile(r'[;|&`$(){}[\]<>!\\]')

# Path traversal patterns
PATH_TRAVERSAL_PATTERN = re.compile(r'(^|/)\.\.(/|$)')


def validate_dbt_selector(selector: str, field_name: str = "selector") -> str:
    """Validate a dbt selector/model name for safe use in subprocess commands.

    Args:
        selector: The selector string to validate
        field_name: Name of the field for error messages

    Returns:
        The validated selector (stripped of whitespace)

    Raises:
        HTTPException: If the selector contains invalid characters
    """
    if not selector:
        return ""

    selector = selector.strip()

    if not selector:
        return ""

    # Check length limit (reasonable max for a selector)
    if len(selector) > 1000:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {field_name}: too long (max 1000 characters)"
        )

    # Check for allowed characters
    if not DBT_SELECTOR_PATTERN.match(selector):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {field_name}: contains invalid characters. "
                   f"Only alphanumeric, underscore, dot, colon, plus, minus, star, slash, comma, @ are allowed."
        )

    # Additional check: no shell metacharacters that might slip through
    dangerous_chars = [';', '|', '&', '`', '$', '(', ')', '{', '}', '[', ']', '<', '>', '!', '\\', '\n', '\r']
    for char in dangerous_chars:
        if char in selector:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid {field_name}: contains forbidden character"
            )

    return selector


def validate_dbt_target(target: str) -> str:
    """Validate a dbt target name.

    Args:
        target: The target name to validate

    Returns:
        The validated target (stripped of whitespace)

    Raises:
        HTTPException: If the target contains invalid characters
    """
    if not target:
        return ""

    target = target.strip()

    if not target:
        return ""

    # Target names should be simple identifiers
    if not re.match(r'^[a-zA-Z0-9_\-]+$', target):
        raise HTTPException(
            status_code=400,
            detail="Invalid target: only alphanumeric, underscore, and hyphen are allowed"
        )

    if len(target) > 100:
        raise HTTPException(
            status_code=400,
            detail="Invalid target: too long (max 100 characters)"
        )

    return target


def validate_git_user_name(name: str) -> str:
    """Validate a git user.name for safe use in git config.

    Args:
        name: The user name to validate

    Returns:
        The validated name (stripped of whitespace)

    Raises:
        HTTPException: If the name contains invalid characters
    """
    if not name:
        raise HTTPException(
            status_code=400,
            detail="Git user name is required"
        )

    name = name.strip()

    if not name:
        raise HTTPException(
            status_code=400,
            detail="Git user name cannot be empty"
        )

    if len(name) > 200:
        raise HTTPException(
            status_code=400,
            detail="Git user name too long (max 200 characters)"
        )

    if not GIT_USER_NAME_PATTERN.match(name):
        raise HTTPException(
            status_code=400,
            detail="Invalid git user name: contains forbidden characters"
        )

    return name


def validate_git_user_email(email: str) -> str:
    """Validate a git user.email for safe use in git config.

    Args:
        email: The email to validate

    Returns:
        The validated email (stripped of whitespace)

    Raises:
        HTTPException: If the email contains invalid characters
    """
    if not email:
        raise HTTPException(
            status_code=400,
            detail="Git user email is required"
        )

    email = email.strip()

    if not email:
        raise HTTPException(
            status_code=400,
            detail="Git user email cannot be empty"
        )

    if len(email) > 254:
        raise HTTPException(
            status_code=400,
            detail="Git user email too long (max 254 characters)"
        )

    if not GIT_USER_EMAIL_PATTERN.match(email):
        raise HTTPException(
            status_code=400,
            detail="Invalid git user email: contains forbidden characters"
        )

    # Basic email format check
    if '@' not in email or '.' not in email.split('@')[-1]:
        raise HTTPException(
            status_code=400,
            detail="Invalid git user email format"
        )

    return email


def validate_git_branch_name(name: str) -> str:
    """Validate a git branch name.

    Args:
        name: The branch name to validate

    Returns:
        The validated branch name (stripped of whitespace)

    Raises:
        HTTPException: If the branch name contains invalid characters
    """
    if not name:
        raise HTTPException(
            status_code=400,
            detail="Branch name is required"
        )

    name = name.strip()

    if not name:
        raise HTTPException(
            status_code=400,
            detail="Branch name cannot be empty"
        )

    if len(name) > 250:
        raise HTTPException(
            status_code=400,
            detail="Branch name too long (max 250 characters)"
        )

    if not GIT_BRANCH_PATTERN.match(name):
        raise HTTPException(
            status_code=400,
            detail="Invalid branch name: only alphanumeric, underscore, dot, hyphen, and slash are allowed"
        )

    # Git-specific restrictions
    if name.startswith('-') or name.startswith('.'):
        raise HTTPException(
            status_code=400,
            detail="Branch name cannot start with '-' or '.'"
        )

    if name.endswith('.') or name.endswith('/'):
        raise HTTPException(
            status_code=400,
            detail="Branch name cannot end with '.' or '/'"
        )

    if '..' in name:
        raise HTTPException(
            status_code=400,
            detail="Branch name cannot contain '..'"
        )

    return name


def validate_file_path(file_path: str, field_name: str = "file path") -> str:
    """Validate a file path for safe use in file operations.

    This validates relative paths within a project directory.

    Args:
        file_path: The file path to validate
        field_name: Name of the field for error messages

    Returns:
        The validated file path (stripped of whitespace)

    Raises:
        HTTPException: If the path contains invalid characters or traversal attempts
    """
    if not file_path:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} is required"
        )

    file_path = file_path.strip()

    if not file_path:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} cannot be empty"
        )

    if len(file_path) > 1000:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} too long (max 1000 characters)"
        )

    # Check for dangerous characters
    if DANGEROUS_PATH_CHARS.search(file_path):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {field_name}: contains forbidden characters"
        )

    # Check for path traversal
    if PATH_TRAVERSAL_PATTERN.search(file_path):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {field_name}: path traversal not allowed"
        )

    # Check for absolute paths (should be relative)
    if file_path.startswith('/'):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {field_name}: absolute paths not allowed"
        )

    # Check for null bytes
    if '\x00' in file_path:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {field_name}: contains null byte"
        )

    return file_path


def validate_commit_message(message: str) -> str:
    """Validate a git commit message.

    Args:
        message: The commit message to validate

    Returns:
        The validated message (stripped of whitespace)

    Raises:
        HTTPException: If the message is invalid
    """
    if not message:
        raise HTTPException(
            status_code=400,
            detail="Commit message is required"
        )

    message = message.strip()

    if not message:
        raise HTTPException(
            status_code=400,
            detail="Commit message cannot be empty"
        )

    if len(message) > 10000:
        raise HTTPException(
            status_code=400,
            detail="Commit message too long (max 10000 characters)"
        )

    # Check for null bytes
    if '\x00' in message:
        raise HTTPException(
            status_code=400,
            detail="Commit message contains invalid characters"
        )

    return message
