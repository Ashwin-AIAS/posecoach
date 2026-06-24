# /run-fix

Execute a fix/improvement brief end-to-end. Usage: `/run-fix $ARGUMENTS`
(e.g. `/run-fix FIX_POSE_TRACKING_QUALITY.md`). The argument is a filename in
`docs/enhancements/`.

## Steps Claude Should Follow

1. **Load the brief** — Read `docs/enhancements/$ARGUMENTS` in full. If it cites a
   superseded brief, skim that too for context.
2. **Confirm current state** — Verify the "what already shipped" claims against the
   actual code/git before changing anything (don't re-do shipped work).
3. **Plan** — Invoke the `prompt-planner` agent: turn the brief's phases into an
   ordered subtask list with done-criteria and risks. Present it and ask:
   "Ready to start? (yes / adjust plan)".
4. **Implement phase by phase** — Work the phases in order. Honor the brief's
   Constraints/Warnings section exactly (for PoseCoach: YOLO26 NMS-free, no
   `end2end=False`, structlog, p95 < 100 ms, no `getUserMedia` resolution bump,
   OneDrive-safe writes verified with `wc -l` + `ast.parse`).
5. **Add the brief's tests** — Then run the `code-reviewer` agent; fix any BLOCK.
6. **Quality gate + evals:**
   ```bash
   ruff check app/ --fix
   mypy app/ --strict
   pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80
   python scripts/eval_latency.py
   python scripts/eval_form_consistency.py
   ```
7. **Definition of Done** — Do not stop until every checkbox in the brief's DoD
   section is checked. If a box can't be met, say why and what's blocking.
8. **Report** — Finish with a diff summary, the before/after eval numbers, and the
   suggested commit sequence from the brief. Remind: "Ready to `/checkpoint`? Run
   `/verify` first."
