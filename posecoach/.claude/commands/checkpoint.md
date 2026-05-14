# /checkpoint

Commit the current state of the thesis project with a structured message.

## Pre-flight Check
1. Confirm `/verify` has been run and passed. If not, run it now.
2. Check for any uncommitted secrets: `git diff --staged | grep -i "api_key\|password\|secret"` — abort if found.

## Steps

1. **Stage all changes:**
   ```bash
   git add -A
   git status
   ```
2. **Identify current prompt** from `CLAUDE.local.md`.
3. **Generate commit message** in format:
   ```
   [P0X] feat: <what was built> (~Xh)

   - completed subtask 1
   - completed subtask 2
   - quality gate: ruff ✓ mypy ✓ pytest ✓
   ```
4. **Show message to user for approval** before committing.
5. **After approval, commit:**
   ```bash
   git commit -m "<approved message>"
   ```
6. **Update `CLAUDE.local.md`** — Mark the prompt as `[x]` in the progress tracker.
7. **Confirm:** "Checkpoint saved. Prompt P0X marked complete. Next: `/run-prompt 0X+1`."
