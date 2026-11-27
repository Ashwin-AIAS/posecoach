# Code Style Rules — Python + TypeScript

## Python (Backend)
- **Version:** Python 3.11 (pyenv). Do NOT use 3.12 system Python.
- **Linter:** `ruff check app/ --fix` — must pass before any commit.
- **Type checker:** `mypy app/ --strict` — all functions must be fully typed.
- **Formatter:** `ruff format app/`
- **Docstrings:** Google-style for all public functions.
- **Imports:** Absolute imports only. No relative imports inside `app/`.
- **Async:** Use `async def` for all FastAPI routes and DB operations. Sync CPU work goes in executor.
- **No bare except** — always catch specific exceptions.
- **Constants** — UPPER_SNAKE_CASE at module level, never inline magic values.

## TypeScript (Frontend)
- **Version:** TypeScript strict mode (`"strict": true` in tsconfig).
- **Linter/Formatter:** ESLint + Prettier (config in `frontend/`).
- **Component naming:** PascalCase React components, camelCase hooks (`usePoseStream`).
- **No `any`** — use proper types or `unknown`.
- **State:** Prefer `useState` + `useReducer` over external state for local UI. Use context sparingly.
- **CSS:** Tailwind utility classes only. No inline styles except for dynamic values.

## Git Commit Format
```
[P0X] type: short description (≤72 chars)

- bullet 1
- bullet 2
```
Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

## Quality Gate (Before Every /checkpoint)
```bash
ruff check app/ --fix
mypy app/ --strict
pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80
```
All three must pass. No exceptions.
