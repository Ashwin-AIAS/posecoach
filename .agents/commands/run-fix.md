# /run-fix

Execute a fix/improvement brief end-to-end. Usage: `/run-fix $ARGUMENTS`
(e.g. `/run-fix FIX_POSE_TRACKING_QUALITY.md`). The argument is a filename in
`docs/enhancements/` or `docs/prompts/`.

## Steps to Follow

1. **Load the brief** — Read `docs/enhancements/$ARGUMENTS` (or `docs/prompts/$ARGUMENTS`) in full.
2. **Confirm current state** — Verify the "what already shipped" claims against the actual code/git before changing anything.
3. **Plan** — Use the `prompt-planner` specialist persona/subagent: turn the brief's phases into an ordered subtask list with done-criteria and risks. Present it and ask: "Ready to start? (yes / adjust plan)".
4. **Implement phase by phase** — Work the phases in order. Honor the brief's Constraints/Warnings section exactly (YOLO26 NMS-free, no `end2end=False`, structlog, p95 < 100 ms, frozen pose core).
5. **Add the brief's tests** — Then run the `code-reviewer` checklist; fix any BLOCK.
6. **Quality gate + evals:**
   ```bash
   ruff check app/ --fix
   mypy app/ --strict
   pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80
   python scripts/eval_latency.py
   python scripts/eval_form_consistency.py
   ```
7. **Definition of Done** — Check every item in the brief's DoD section.
8. **Report** — Finish with a diff summary, before/after eval numbers, and suggested commit sequence.
