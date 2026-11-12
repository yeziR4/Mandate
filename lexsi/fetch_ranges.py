"""
Resume a large download in parallel ranges.

    python lexsi/fetch_ranges.py --url <url> --out lexsi/models/x.gguf --parts 8

The single connection to this host peaks around 1 MB/s and drops without close_notify. Splitting the
remaining byte range across connections both speeds it up and makes a dropped connection cost one
chunk instead of the whole file.
"""
from __future__ import annotations

import argparse
import os
import sys
import threading
import time
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

LOCK = threading.Lock()
DONE = {"bytes": 0}


def head_size(url: str, headers: dict[str, str]) -> int:
    request = urllib.request.Request(url, method="HEAD", headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        return int(response.headers["Content-Length"])


def fetch_range(url: str, headers: dict[str, str], start: int, end: int, part: Path, label: str) -> None:
    attempt = 0
    while attempt < 12:
        attempt += 1
        have = part.stat().st_size if part.exists() else 0
        want = end - start + 1
        if have >= want:
            return
        request_headers = dict(headers)
        request_headers["Range"] = f"bytes={start + have}-{end}"
        try:
            request = urllib.request.Request(url, headers=request_headers)
            with urllib.request.urlopen(request, timeout=120) as response, part.open("ab") as handle:
                while True:
                    chunk = response.read(1 << 16)
                    if not chunk:
                        break
                    handle.write(chunk)
                    with LOCK:
                        DONE["bytes"] += len(chunk)
        except Exception as cause:
            print(f"  [{label}] attempt {attempt} failed: {type(cause).__name__}", flush=True)
            time.sleep(min(2 * attempt, 10))
    if not part.exists() or part.stat().st_size < end - start + 1:
        raise RuntimeError(f"{label} incomplete after retries")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--token", default="")
    parser.add_argument("--parts", type=int, default=8)
    args = parser.parse_args()

    headers = {"User-Agent": "wick/1.0"}
    if args.token:
        headers["Authorization"] = f"Bearer {args.token}"

    out = Path(args.out)
    total = head_size(args.url, headers)
    have = out.stat().st_size if out.exists() else 0
    print(f"size {total/1e9:.2f} GB · already have {have/1e6:.0f} MB · remaining {(total-have)/1e6:.0f} MB")

    if have >= total:
        print("already complete")
        return

    span = total - have
    chunk = span // args.parts + 1
    jobs = []
    for index in range(args.parts):
        start = have + index * chunk
        end = min(start + chunk - 1, total - 1)
        if start > end:
            continue
        part = out.with_suffix(out.suffix + f".part{index}")
        if part.exists() and part.stat().st_size > end - start + 1:
            part.unlink()
        jobs.append((start, end, part, f"p{index}"))

    threads = []
    for start, end, part, label in jobs:
        thread = threading.Thread(target=fetch_range, args=(args.url, headers, start, end, part, label), daemon=True)
        thread.start()
        threads.append(thread)

    started = time.time()
    while any(thread.is_alive() for thread in threads):
        time.sleep(5)
        with LOCK:
            done = DONE["bytes"]
        elapsed = max(1e-6, time.time() - started)
        print(f"  {done/1e6:6.0f} MB in {elapsed:5.0f}s  ({done/1e6/elapsed:4.2f} MB/s)", flush=True)

    for thread in threads:
        thread.join()

    print("assembling")
    with out.open("ab") as handle:
        for _, _, part, _ in jobs:
            with part.open("rb") as source:
                while True:
                    block = source.read(1 << 20)
                    if not block:
                        break
                    handle.write(block)
            part.unlink()

    final = out.stat().st_size
    print(f"final {final/1e9:.2f} GB ({'ok' if final == total else 'SIZE MISMATCH'})")


if __name__ == "__main__":
    main()
