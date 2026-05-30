# /run-prompt

Start working on thesis prompt $ARGUMENTS (e.g. `/run-prompt 01`).

## Steps Claude Should Follow

1. **Load context** — Read `.claude/skills/p$ARGUMENTS-*/SKILL.md` for the full prompt spec.
2. **Check prerequisites** — Verify previous prompt is complete (check `CLAUDE.local.md` progress tracker).
3. **Invoke prompt-planner agent** — Produce a plan with subtasks, risks, and done criteria before writing any code.
4. **Wait for approval** — Present the plan and ask: "Ready to start implementation? (yes / adjust plan)"
5. **Implement subtask by subtask** — Work through the plan sequentially. Run quality gates after each subtask.
6. **After all subtasks** — Run `code-reviewer` agent. Fix any BLOCK issues.
7. **Run quality gate:**
   ```bash
   ruff check app/ --fix
   mypy app/ --strict
   pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80
   ```
8. **Remind user** — "Ready to `/checkpoint`? Run `/verify` first."
