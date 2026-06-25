# How to Run P23–P28 with Claude Code

The plan docs are the **spec**. The kickoff prompts below are what you **paste into
Claude Code** to make it execute a prompt correctly — reading the guardrails first
and holding the stage → gate → push discipline.

**Workflow per prompt:** paste the kickoff → Claude Code runs stage by stage,
pushing after each → it opens a PR and STOPS → you review/merge on GitHub → move to
the next prompt. One Claude Code session per prompt (keeps context lean).

---

## 1) Kickoff: P23 (nav shell + Settings) — paste this now

```
Execute prompt P23 on the PoseCoach repo.

Read first, in order (these are binding):
1. docs/enhancements/WORKOUT_NUTRITION_ROADMAP_P23-P28.md  (program guardrails)
2. docs/enhancements/NAV_TABS_AND_SETTINGS_P23.md          (the prompt to execute)

Rules:
- Work the stages strictly in order (Stage 0 -> Stage 3). Do not skip ahead.
- After each stage: run that stage's acceptance gate. Only when it is green,
  commit with the stage's [P23] message and run: git push origin feat/p23-nav-shell
  Do NOT begin the next stage until that push succeeds.
- Never modify any file in the roadmap's FROZEN pose-core list. The ONLY existing
  file P23 may edit is frontend/src/App.tsx (wrap the Coach branch, do not alter it).
- Additive only. Dark-only, English-only. No backend, no DB, no migration in P23.
- If an existing test fails, STOP and report. Do not "fix" it by changing the core.
- At each stage boundary, report: stage finished, gate result, pushed commit hash.

When all four stages pass and are pushed: open a PR to main titled
"[P23] Navigation shell + Settings tab", then STOP. Do not start P24.
```

---

## 2) Between prompts

1. Review the P23 PR on GitHub; confirm the diff touches only `App.tsx` (existing)
   plus the new files. Merge to `main`.
2. Open the P24 doc and read its **"Open decisions — confirm or reframe"** section.
   Change anything you want; if you change a decision, edit the doc before running.
3. Start a **fresh** Claude Code session, then paste the P24 kickoff below.

---

## 3) Kickoff: P24 (workout logger backend) — paste after P23 is merged

```
Execute prompt P24 on the PoseCoach repo.

Pre-flight:
- Confirm P23 is merged and you are on an up-to-date main (git pull).
- Read first: docs/enhancements/WORKOUT_NUTRITION_ROADMAP_P23-P28.md (guardrails),
  then docs/enhancements/WORKOUT_LOGGER_DATA_API_P24.md.
- The doc's "Open decisions" must be settled. Follow the doc as written unless the
  user changed a decision; if anything is ambiguous, ASK before writing code.

Rules:
- Work the stages strictly in order (Stage 0 -> Stage 4). Do not skip ahead.
- After each stage: run the gate. Only when green, commit with the stage's [P24]
  message and run: git push origin feat/p24-workout-logger-api
  Do NOT begin the next stage until that push succeeds.
- Backend-only and additive. The ONLY existing files you may edit are app/models.py
  (additions) and app/main.py (one include_router line). Never touch the frozen
  pose core. Tests use SQLite in-memory.
- If an existing test fails, STOP and report.
- At each stage boundary, report: stage finished, gate result, pushed commit hash.

When all stages pass and are pushed: open a PR titled
"[P24] Workout logger: data model + API + catalog", then STOP. Do not start P25.
```

---

## 4) Reusable template (for P25–P28)

Swap the bracketed parts; everything else stays the same.

```
Execute prompt [P2X] on the PoseCoach repo.

Read first: docs/enhancements/WORKOUT_NUTRITION_ROADMAP_P23-P28.md (guardrails),
then docs/enhancements/[THE_P2X_DOC].md.

Rules:
- Stages strictly in order; do not skip.
- After each stage: run the gate; when green, commit with the stage's [P2X] message
  and run: git push origin [the-feature-branch]. Do not start the next stage until
  the push succeeds.
- Respect the roadmap guardrails: pose core FROZEN, additive only, dark/English-only.
- Only edit the existing files the doc names; everything else is new files.
- If an existing test fails, STOP and report.
- Report stage finished + gate result + commit hash at each boundary.

When all stages pass and are pushed: open the PR the doc names, then STOP.
```

---

## Why these rules

- **Read the roadmap first** so Claude Code internalizes the frozen-core boundary
  before it writes anything.
- **Push after every stage** so each stage is independently recoverable on GitHub —
  if a later stage goes wrong, you roll back to the last pushed stage, not zero.
- **STOP at the PR** so you stay the gate between prompts (review + merge), and
  Claude Code never silently chains P23 into P24.
