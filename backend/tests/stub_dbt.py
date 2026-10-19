#!/usr/bin/env python3
"""Stand-in for the dbt CLI used by scheduler tests.

Behaviour is controlled with STUB_* environment variables:
  STUB_SLEEP=<seconds>   sleep before finishing (for cancel/timeout/overlap tests)
  STUB_FAIL=1            exit with code 1 and an error model result
  STUB_PRINT_ENV=<NAME>  print the value of an env var (credential tests)
"""
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    args = sys.argv[1:]
    command = args[0] if args else ""
    project_dir = Path(args[args.index("--project-dir") + 1]) if "--project-dir" in args else Path.cwd()

    print(f"Running with dbt=stub command={command} args={' '.join(args[1:])}", flush=True)
    print(f"cwd={Path.cwd()}", flush=True)
    name = os.environ.get("STUB_PRINT_ENV")
    if name:
        print(f"ENV {name}={os.environ.get(name, '<unset>')}", flush=True)

    start = datetime.now(timezone.utc)
    time.sleep(float(os.environ.get("STUB_SLEEP", "0")))
    end = datetime.now(timezone.utc)
    failed = os.environ.get("STUB_FAIL") == "1"

    if command in ("run", "build", "test", "seed", "compile"):
        stamp = lambda d: d.strftime("%Y-%m-%dT%H:%M:%S.%fZ")  # noqa: E731
        results = [
            {
                "unique_id": "model.proj.orders",
                "status": "error" if failed else "success",
                "thread_id": "Thread-1",
                "execution_time": (end - start).total_seconds(),
                "timing": [{"name": "execute", "started_at": stamp(start), "completed_at": stamp(end)}],
                "adapter_response": {"_message": "INSERT 0 42", "rows_affected": 42},
                "message": "boom" if failed else "INSERT 0 42",
            },
            {
                "unique_id": "model.proj.customers_view",
                "status": "success",
                "thread_id": "Thread-2",
                "execution_time": 0.01,
                "timing": [{"name": "execute", "started_at": stamp(start), "completed_at": stamp(end)}],
                "adapter_response": {"_message": "CREATE VIEW", "rows_affected": -1},
                "message": "CREATE VIEW",
            },
        ]
        target = project_dir / "target"
        target.mkdir(parents=True, exist_ok=True)
        (target / "run_results.json").write_text(json.dumps({"results": results}))

    if failed:
        print("Completed with 1 error", flush=True)
        print("Database Error: boom", file=sys.stderr, flush=True)
        return 1
    print("Completed successfully", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
