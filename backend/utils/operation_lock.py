"""Per-worktree operation lock for multi-user conflict prevention."""
import threading
from typing import Optional, Dict
from datetime import datetime
import uuid


class WorktreeLock:
    """Lock state for a specific worktree."""

    def __init__(self):
        self.lock = threading.Lock()
        self.current_operation: Optional[str] = None
        self.operation_started_at: Optional[datetime] = None
        self.last_completed_operation: Optional[str] = None
        self.last_completed_at: Optional[datetime] = None
        self.last_completion_id: Optional[str] = None


# Dictionary of locks per worktree path
_worktree_locks: Dict[str, WorktreeLock] = {}
_locks_mutex = threading.Lock()  # Protects access to _worktree_locks dict


def _get_worktree_lock(worktree_path: str) -> WorktreeLock:
    """Get or create a lock for the given worktree path."""
    with _locks_mutex:
        if worktree_path not in _worktree_locks:
            _worktree_locks[worktree_path] = WorktreeLock()
        return _worktree_locks[worktree_path]


def get_lock_status(worktree_path: str) -> dict:
    """Get current lock status for a specific worktree."""
    wt_lock = _get_worktree_lock(worktree_path)

    is_locked = wt_lock.lock.locked()

    return {
        "is_locked": is_locked,
        "operation": wt_lock.current_operation if is_locked else None,
        "started_at": wt_lock.operation_started_at.isoformat() if is_locked and wt_lock.operation_started_at else None,
        "last_completed_operation": wt_lock.last_completed_operation,
        "last_completed_at": wt_lock.last_completed_at.isoformat() if wt_lock.last_completed_at else None,
        "last_completion_id": wt_lock.last_completion_id,
    }


def acquire_lock(worktree_path: str, operation_name: str) -> bool:
    """Try to acquire the lock for a specific worktree. Returns True if acquired, False otherwise."""
    wt_lock = _get_worktree_lock(worktree_path)

    if wt_lock.lock.acquire(blocking=False):
        wt_lock.current_operation = operation_name
        wt_lock.operation_started_at = datetime.now()
        return True
    return False


def release_lock(worktree_path: str, success: bool = True):
    """Release the lock for a specific worktree and record completion for multi-user sync."""
    wt_lock = _get_worktree_lock(worktree_path)

    try:
        # Record completion before clearing current operation
        wt_lock.last_completed_operation = wt_lock.current_operation
        wt_lock.last_completed_at = datetime.now()
        wt_lock.last_completion_id = str(uuid.uuid4())

        wt_lock.current_operation = None
        wt_lock.operation_started_at = None
        wt_lock.lock.release()
    except RuntimeError:
        # Lock was not held
        pass


def is_locked(worktree_path: str) -> bool:
    """Check if lock is currently held for a specific worktree."""
    wt_lock = _get_worktree_lock(worktree_path)
    return wt_lock.lock.locked()
