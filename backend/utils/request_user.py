"""The dbt UI user making a request.

The frontend sends the git identity the user set up in dbt UI (the same name used as the
author of their commits) in the X-DBT-UI-User header, URL-encoded so any name fits in a header.
"""
from urllib.parse import unquote

from fastapi import HTTPException, Request

from utils.input_validation import validate_git_user_name

USER_HEADER = "X-DBT-UI-User"


def get_request_user(request: Request) -> str:
    """The requesting user's name, or '' if the request doesn't carry a valid one."""
    raw = request.headers.get(USER_HEADER, "")
    if not raw:
        return ""
    try:
        return validate_git_user_name(unquote(raw))
    except HTTPException:
        return ""
