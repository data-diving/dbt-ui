"""Subprocess utility functions for running commands with common options."""
from pathlib import Path
from typing import List, Optional, Dict, Union
from contextlib import contextmanager
import subprocess
import tempfile
import stat
import os


class CommandResult:
    """Result of a subprocess command execution."""

    def __init__(self, returncode: int, stdout: str, stderr: str):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr

    @property
    def success(self) -> bool:
        return self.returncode == 0

    @property
    def output(self) -> str:
        """Get stdout, or stderr if stdout is empty."""
        return self.stdout or self.stderr

    @property
    def error(self) -> str:
        """Get stderr, or stdout if stderr is empty."""
        return self.stderr or self.stdout


def run_command(
    cmd: List[str],
    cwd: Union[str, Path],
    timeout: int = 30,
    env: Optional[Dict[str, str]] = None
) -> CommandResult:
    """Run a subprocess command with common options.

    Args:
        cmd: Command and arguments as a list
        cwd: Working directory to run the command in
        timeout: Timeout in seconds (default: 30)
        env: Optional environment variables (if None, inherits current env)

    Returns:
        CommandResult with returncode, stdout, and stderr

    Raises:
        subprocess.TimeoutExpired: If command exceeds timeout
    """
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=str(cwd),
        env=env
    )
    return CommandResult(result.returncode, result.stdout, result.stderr)


def run_git_command(
    args: List[str],
    cwd: Union[str, Path],
    git_dir: Optional[Union[str, Path]] = None,
    timeout: int = 30,
    env: Optional[Dict[str, str]] = None
) -> CommandResult:
    """Run a git command with common options.

    Args:
        args: Git subcommand and arguments (without 'git' prefix)
        cwd: Working directory to run the command in (for process isolation)
        git_dir: Optional git directory to use with -C flag. If not provided,
                 git will use the repository at cwd.
        timeout: Timeout in seconds (default: 30)
        env: Optional environment variables (if None, inherits current env)

    Returns:
        CommandResult with returncode, stdout, and stderr

    Raises:
        subprocess.TimeoutExpired: If command exceeds timeout

    Examples:
        # Run 'git status' in a directory
        result = run_git_command(['status'], cwd='/path/to/repo')

        # Run 'git -C /repo branch --list' from a different cwd
        result = run_git_command(['branch', '--list'], cwd='/worktree', git_dir='/repo')
    """
    if git_dir:
        cmd = ['git', '-C', str(git_dir)] + args
    else:
        cmd = ['git'] + args

    return run_command(cmd, cwd, timeout, env)


@contextmanager
def git_askpass_env(username: str, password: str, base_env: Optional[Dict[str, str]] = None):
    """Context manager that creates a temporary GIT_ASKPASS script for HTTPS authentication.

    This is the secure way to pass credentials to git - it avoids exposing credentials
    in CLI arguments (which would be visible in ps, logs, /proc).

    Args:
        username: Git username
        password: Git password or personal access token
        base_env: Base environment dict to extend (defaults to os.environ.copy())

    Yields:
        Dict of environment variables with GIT_ASKPASS configured

    Example:
        with git_askpass_env(username, password) as env:
            result = run_command(['git', 'push'], cwd, env=env)
    """
    env = (base_env or os.environ).copy()

    # Create a temporary script that outputs credentials based on git's prompt
    with tempfile.NamedTemporaryFile(mode='w', suffix='.sh', delete=False) as askpass_script:
        # Script checks if prompt contains "Username" or "Password" and responds accordingly
        askpass_script.write('#!/bin/sh\n')
        askpass_script.write(f'case "$1" in\n')
        askpass_script.write(f'  *sername*) echo "{username}" ;;\n')
        askpass_script.write(f'  *assword*) echo "{password}" ;;\n')
        askpass_script.write(f'esac\n')
        askpass_script_path = askpass_script.name

    # Make script executable
    os.chmod(askpass_script_path, stat.S_IRWXU)

    try:
        # Set GIT_ASKPASS to use our script (credentials never appear in CLI args)
        env['GIT_ASKPASS'] = askpass_script_path
        env['GIT_TERMINAL_PROMPT'] = '0'  # Disable terminal prompts
        yield env
    finally:
        # Always clean up the temporary script
        try:
            os.unlink(askpass_script_path)
        except OSError:
            pass
