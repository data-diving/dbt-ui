"""Simple authentication module using environment variables."""
import os
import secrets
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials

security = HTTPBasic()

# Get credentials from environment variables
BACKEND_USER = os.environ.get("DBT_UI__BACKEND_USER", "")
BACKEND_PASSWORD = os.environ.get("DBT_UI__BACKEND_PASSWORD", "")


def is_auth_enabled() -> bool:
    """Check if authentication is enabled (both user and password are set)."""
    return bool(BACKEND_USER and BACKEND_PASSWORD)


def verify_credentials(credentials: HTTPBasicCredentials = Depends(security)):
    """Verify HTTP Basic credentials against environment variables."""
    if not is_auth_enabled():
        # Auth not configured, allow access
        return True

    # Use constant-time comparison to prevent timing attacks
    correct_username = secrets.compare_digest(
        credentials.username.encode("utf-8"),
        BACKEND_USER.encode("utf-8")
    )
    correct_password = secrets.compare_digest(
        credentials.password.encode("utf-8"),
        BACKEND_PASSWORD.encode("utf-8")
    )

    if not (correct_username and correct_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Basic"},
        )

    return True
