"""Thesis evaluation — System Usability Scale (SUS) user study gate.

Parses anonymized participant survey files from ``data/eval/sus_responses/``,
computes each participant's SUS score with the standard Brooke (1996) formula,
and aggregates. The thesis gate is **mean SUS >= 70 with n >= 10 participants**.

SUS scoring (10 items, each answered 1=Strongly disagree .. 5=Strongly agree):
* odd items (1,3,5,7,9):  contribution = response - 1
* even items (2,4,6,8,10): contribution = 5 - response
* SUS = (sum of contributions) * 2.5  → 0..100

Privacy: participant files contain an anonymized ``participant_id`` only — never
names or emails (GDPR / thesis ethics).

On first run this script also writes a blank ``_TEMPLATE.json`` and a
``_SUS_PROTOCOL.md`` into the responses directory to standardize collection.
Files whose name starts with ``_`` are treated as docs and never counted.

Output: ``data/eval/sus_results.json``. Exit 0 if the gate passes, 1 if it
fails, 2 if there are not yet enough participants to evaluate.
"""
from __future__ import annotations

import datetime as dt
import json
import platform
import sys
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger(__name__)

RESPONSES_DIR = Path("data/eval/sus_responses")
OUTPUT_PATH = Path("data/eval/sus_results.json")
SUS_GATE = 70.0
MIN_PARTICIPANTS = 10
N_ITEMS = 10

# Canonical SUS statements (Brooke, 1996). Odd = positively worded.
SUS_QUESTIONS = [
    "I think that I would like to use this system frequently.",
    "I found the system unnecessarily complex.",
    "I thought the system was easy to use.",
    "I think that I would need the support of a technical person to be able to use this system.",
    "I found the various functions in this system were well integrated.",
    "I thought there was too much inconsistency in this system.",
    "I would imagine that most people would learn to use this system very quickly.",
    "I found the system very cumbersome to use.",
    "I felt very confident using the system.",
    "I needed to learn a lot of things before I could get going with this system.",
]


def compute_sus(responses: list[int]) -> float:
    """Compute a 0..100 SUS score from 10 Likert responses (1..5)."""
    if len(responses) != N_ITEMS:
        raise ValueError(f"SUS needs {N_ITEMS} responses, got {len(responses)}")
    total = 0
    for i, resp in enumerate(responses):
        if not 1 <= resp <= 5:
            raise ValueError(f"Response {i + 1} out of range 1..5: {resp}")
        total += (resp - 1) if i % 2 == 0 else (5 - resp)
    return total * 2.5


def _write_collection_assets() -> None:
    """Create the template + protocol doc if absent (idempotent)."""
    template = RESPONSES_DIR / "_TEMPLATE.json"
    if not template.exists():
        template.write_text(
            json.dumps(
                {
                    "participant_id": "P01",
                    "timestamp": "2026-06-01T10:00:00Z",
                    "demographics": {"gym_experience_years": 0, "age_band": "18-24"},
                    "responses": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                    "_responses_help": "10 integers 1-5, in SUS question order. Replace zeros.",
                    "free_text": "",
                },
                indent=2,
            )
        )
        logger.info("sus_template_written", path=str(template))

    protocol = RESPONSES_DIR / "_SUS_PROTOCOL.md"
    if not protocol.exists():
        lines = [
            "# PoseCoach User Study — SUS Protocol",
            "",
            "## Procedure",
            "1. Recruit >= 10 gym-goers (not CS experts). Assign anonymized IDs (P01, P02...).",
            "2. Each participant performs 3 exercises with PoseCoach live coaching.",
            "3. Immediately after, they rate the 10 SUS statements (1=Strongly disagree, 5=Strongly agree).",
            "4. Save one file per participant as `P01.json` etc. using `_TEMPLATE.json`.",
            "5. Re-run `python scripts/eval_user_study.py`.",
            "",
            "## SUS Statements (answer order matters)",
        ]
        lines += [f"{i + 1}. {q}" for i, q in enumerate(SUS_QUESTIONS)]
        lines += [
            "",
            "## Scoring",
            "Odd items: response - 1. Even items: 5 - response. Sum * 2.5 = SUS (0-100).",
            "Thesis gate: mean SUS >= 70, n >= 10. Industry benchmark: 68 = average, >= 70 = good.",
            "",
            "## Privacy",
            "Store anonymized IDs only — no names or emails (GDPR Article 17 / thesis ethics).",
        ]
        protocol.write_text("\n".join(lines) + "\n")
        logger.info("sus_protocol_written", path=str(protocol))


def _load_participants() -> tuple[list[dict[str, Any]], list[str]]:
    """Load valid participant files; return (records, errors)."""
    records: list[dict[str, Any]] = []
    errors: list[str] = []
    for f in sorted(RESPONSES_DIR.glob("*.json")):
        if f.name.startswith("_"):
            continue
        try:
            data = json.loads(f.read_text())
            sus = compute_sus(data["responses"])
            records.append(
                {"participant_id": data.get("participant_id", f.stem), "sus": round(sus, 2)}
            )
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            errors.append(f"{f.name}: {exc}")
            logger.error("sus_file_invalid", file=f.name, error=str(exc))
    return records, errors


def main() -> int:
    RESPONSES_DIR.mkdir(parents=True, exist_ok=True)
    _write_collection_assets()

    records, errors = _load_participants()
    n = len(records)
    scores = [r["sus"] for r in records]
    mean_sus = round(sum(scores) / n, 2) if n else None

    if n < MIN_PARTICIPANTS:
        gate_passed: bool | None = None
        reason = f"insufficient_participants (n={n} < {MIN_PARTICIPANTS}) — collection pending"
        exit_code = 2
    else:
        gate_passed = mean_sus is not None and mean_sus >= SUS_GATE
        reason = "evaluated"
        exit_code = 0 if gate_passed else 1

    payload = {
        "metric": "user_study_sus",
        "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
        "hardware": platform.platform(),
        "gate_sus": SUS_GATE,
        "min_participants": MIN_PARTICIPANTS,
        "n_participants": n,
        "mean_sus": mean_sus,
        "min_sus": min(scores) if scores else None,
        "max_sus": max(scores) if scores else None,
        "thesis_gate_passed": gate_passed,
        "gate_reason": reason,
        "parse_errors": errors,
        "per_participant": records,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2))
    logger.info(
        "sus_eval_complete",
        n_participants=n,
        mean_sus=mean_sus,
        gate_passed=gate_passed,
        output=str(OUTPUT_PATH),
    )
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
