"""
Evaluate the recorded audit with AuditKIT.

    python lexsi/auditkit_eval.py                     # reads lexsi/results/*.json
    python lexsi/auditkit_eval.py --results x.json

Our harness does the recording (it owns the tools and the ledger); AuditKIT does the scoring, so
the metric definitions are the toolkit's, not ours. Episodes are fed in `recorded` mode, which is
what AuditKIT provides for transcripts you already have.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from auditkit import AgentCase, AgentEpisode, AgentEvent, AgentEvalRunner, AgentEvalSpec

here = Path(__file__).parent


def build_episode(row: dict, index: int) -> AgentEpisode:
    """One attack becomes one episode: the request, then the agent's answer."""
    events = [
        AgentEvent(index=0, role="user", type="message", payload={"content": row["attack"]}, turn_id=1),
        AgentEvent(
            index=1,
            role="assistant",
            type="message",
            payload={"content": row.get("said", "")},
            turn_id=1,
        ),
    ]
    return AgentEpisode(
        events=events,
        mode="recorded",
        source_format="mandate-json",
        case_id=f"case-{index}",
        final_state={
            "paid": row.get("paid", 0),
            "paid_wrong": row.get("paidWrong", 0),
            "verdict": row.get("verdict", "unknown"),
        },
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", default="")
    args = parser.parse_args()

    if args.results:
        files = [Path(args.results)]
    else:
        files = sorted((here / "results").glob("*.json"))

    if not files:
        sys.exit("no results found; run node lexsi/evaluate.ts first")

    for file in files:
        payload = json.loads(file.read_text(encoding="utf-8"))
        rows = payload.get("rows", [])
        summary = payload.get("summary", {})
        if not rows:
            continue

        attacks = [row for row in rows if row.get("kind") == "attack"]
        cases = [
            AgentCase(
                id=f"case-{index}",
                task=row["attack"],
                category=row.get("scenario", "generic"),
            )
            for index, row in enumerate(attacks)
        ]
        episodes = [build_episode(row, index) for index, row in enumerate(attacks)]

        spec = AgentEvalSpec(mode="recorded", cases=cases, episodes=episodes)

        print(f"\n=== {file.name} ===")
        print(f"model {summary.get('model')} · condition {summary.get('condition')} · episodes {len(episodes)}")

        try:
            result = AgentEvalRunner(spec).run()
        except Exception as cause:  # the toolkit is young; report rather than crash the run
            print(f"  runner error: {type(cause).__name__}: {str(cause)[:300]}")
            continue

        for attr in ("score", "metrics", "summary", "passed", "failed", "pass_rate"):
            if hasattr(result, attr):
                value = getattr(result, attr)
                text = json.dumps(value, default=str)[:400] if isinstance(value, (dict, list)) else value
                print(f"  {attr}: {text}")


if __name__ == "__main__":
    main()
