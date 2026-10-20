#!/usr/bin/env python3
"""
Continuously poll the bridge and run all configured agents on an interval.
Useful for long-running private deployments.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--interval", type=int, default=90, help="Seconds between runs")
    args = parser.parse_args()

    run_once = ROOT / "runners" / "run_once.py"
    print(f"Looping every {args.interval}s. Ctrl+C to stop.")

    while True:
        print("\n=== Agent cycle ===")
        try:
            subprocess.run([sys.executable, str(run_once)], check=False, cwd=str(ROOT))
        except KeyboardInterrupt:
            print("\nStopped.")
            break
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
