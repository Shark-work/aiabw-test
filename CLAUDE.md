# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

Backing project for a [learnwithparam.com](https://www.learnwithparam.com) course. See `README.md` for the subject and walkthrough.

## Quick start

```bash
uv sync              # Python projects (or: npm install / go mod tidy)
cp .env.example .env # populate BAILIAN_API_KEY/BAILIAN_MODEL and any other keys
uv run uvicorn main:app --reload --port 8111
```

## Smoke test

This repo is covered by the shared sweep in `../smoke_test_all.sh`. To run just this one:

```bash
bash ../smoke_test_all.sh fullstack-agents-nextjs
```

Expect: 200 OK from the main endpoint + a real LLM response (not a stub).

## Push workflow

Before every push, always:

1. Run the smoke test above. It must pass.
2. Verify `.gitignore` covers `.env`, `__pycache__/`, `.venv/`, data dirs, and OS files.
3. `git status` — confirm no tracked secrets, no data artefacts, no local scratch files.
4. Commit with a descriptive message.
5. `git push origin main` — remote is `git@github.com:learnwithparam/fullstack-agents-nextjs.git`.

Never force-push. Never commit `.env` or populated data directories.
