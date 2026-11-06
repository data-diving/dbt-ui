"""Subprocess utility functions for running commands with common options."""
from pathlib import Path
from typing import List, Optional, Dict, Union
from contextlib import contextmanager
import subprocess
import sys
import tempfile
import stat
import os


# dbt UI's own settings (encryption key, login password, database URL, ...) all start with this
# prefix. Commands run for users (dbt, git, uv) must not see them: a model can read any
# environment variable with env_var().
BACKEND_SETTINGS_PREFIX = "DBT_UI__"


def child_env() -> Dict[str, str]:
    """The backend's environment without dbt UI's own settings, as the base for every subprocess."""
    return {k: v for k, v in os.environ.items() if not k.startswith(BACKEND_SETTINGS_PREFIX)}


# How much lower than the backend dbt and other heavy helpers run (nice increment)
NICE_INCREMENT = 10


def lower_process_priority(pid: int) -> None:
    """Best effort: lower CPU priority, and make the process the first one the kernel's OOM killer
    picks, so a heavy dbt command can't make the UI slow or take the backend down. Children inherit it."""
    if sys.platform.startswith("linux"):
        try:
            Path(f"/proc/{pid}/oom_score_adj").write_text("1000")
        except OSError as e:
            print(f"[subprocess] Could not set oom_score_adj for {pid}: {e}")
    try:
        os.setpriority(os.PRIO_PROCESS, pid, NICE_INCREMENT)
    except (OSError, AttributeError) as e:
        print(f"[subprocess] Could not lower priority for {pid}: {e}")


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
    env: Optional[Dict[str, str]] = None,
    low_priority: bool = False,
) -> CommandResult:
    """Run a subprocess command with common options.

    Args:
        cmd: Command and arguments as a list
        cwd: Working directory to run the command in
        timeout: Timeout in seconds (default: 30)
        env: Optional environment variables (if None, the backend's env without its settings)
        low_priority: Run it with lower CPU priority and killed first when memory runs out
            (dbt and environment builds started outside the scheduler's queue)

    Returns:
        CommandResult with returncode, stdout, and stderr

    Raises:
        subprocess.TimeoutExpired: If command exceeds timeout
    """
    if low_priority:
        with subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=str(cwd),
            env=env if env is not None else child_env(),
        ) as process:
            lower_process_priority(process.pid)
            try:
                stdout, stderr = process.communicate(timeout=timeout)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()
                raise
        return CommandResult(process.returncode, stdout, stderr)

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=str(cwd),
        env=env if env is not None else child_env()
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
        env: Optional environment variables (if None, the backend's env without its settings)

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
        base_env: Base environment dict to extend (defaults to child_env())

    Yields:
        Dict of environment variables with GIT_ASKPASS configured

    Example:
        with git_askpass_env(username, password) as env:
            result = run_command(['git', 'push'], cwd, env=env)
    """
    env = dict(base_env) if base_env is not None else child_env()

    # Create a temporary script that outputs credentials based on git's prompt. The values are
    # passed through the environment and printed verbatim: never put them into the script text,
    # where the shell would run $(...) or backticks in a password.
    with tempfile.NamedTemporaryFile(mode='w', suffix='.sh', delete=False) as askpass_script:
        askpass_script.write('#!/bin/sh\n')
        askpass_script.write('case "$1" in\n')
        askpass_script.write('  *sername*) printf \'%s\\n\' "$DBT_UI_GIT_ASKPASS_USERNAME" ;;\n')
        askpass_script.write('  *assword*) printf \'%s\\n\' "$DBT_UI_GIT_ASKPASS_PASSWORD" ;;\n')
        askpass_script.write('esac\n')
        askpass_script_path = askpass_script.name
    env['DBT_UI_GIT_ASKPASS_USERNAME'] = username
    env['DBT_UI_GIT_ASKPASS_PASSWORD'] = password

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
