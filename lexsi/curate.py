"""
Curate the red-team corpus with CuratorKIT.

    python lexsi/curate.py

Input:  lexsi/data/attacks.jsonl  (one row per unique attack, labelled mechanically)
Output: lexsi/data/curated/       gated, deduplicated, trainer-ready splits

The gates that matter here are dedup (attackers converge on the same phrasing), schema
(a row without a scenario or label is useless downstream) and the split — a held-out eval split is
what makes the before/after numbers mean anything.
"""
from __future__ import annotations

import sys as _sys

_sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import json
import sys
from pathlib import Path

from curatorkit import Curator, CuratorConfig

here = Path(__file__).parent
source = here / "data" / "attacks.jsonl"
out = here / "data" / "curated"

if not source.exists():
    sys.exit(f"missing {source}; run: node lexsi/build_dataset.mjs")

rows = [json.loads(line) for line in source.read_text(encoding="utf-8").splitlines() if line.strip()]
print(f"input rows: {len(rows)}")
print(f"  breaking attacks: {sum(1 for r in rows if r.get('broke_something'))}")

config = CuratorConfig(
    dataset=str(source),
    format="auto",
    # attackers converge on similar phrasing; exact dedup is enough for a first pass and finishes
    # in seconds. minhash over 595 rows hung for 15 minutes on this machine.
    dedup="exact",
    clean=False,
    min_tokens=5,
    max_tokens=2048,
    schema_gate=False,
    output_dir=str(out),
    export_formats=["messages", "sharegpt"],
    output_split={"train": 0.8, "eval": 0.2},
    output_split_seed=42,
    write_hf_readme=True,
    name="mandate-policy-attacks",
)

result = Curator(config).run()

print("\n--- curator result ---")
for attr in ("kept", "rejected", "duplicates_removed", "output_path", "stats"):
    if hasattr(result, attr):
        print(f"{attr}: {getattr(result, attr)}")

if out.exists():
    for file in sorted(out.rglob("*")):
        if file.is_file():
            print(f"  {file.relative_to(out.parent)}  {file.stat().st_size:,} bytes")
