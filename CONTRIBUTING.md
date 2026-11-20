# Contributing

This repository contains the Mosaic Windows desktop app. Read [the architecture overview](docs/ARCHITECTURE_OVERVIEW.md) and [desktop setup guide](desktop/README.md) before changing its runtime, standalone app, or release process.

## Make a focused change

1. Check the current branch and `git status`; preserve existing edits.
2. Keep app changes under `desktop/`. Keep desktop SQL setup under `supabase/` and update its setup guide when needed.
3. Keep secrets, local environment files, generated builds, and personal data out of Git.
4. Update the nearest guide when setup, behavior, or file placement changes. Update `handoff.md` only when explicitly requested.

## Run relevant checks

Use the commands in [desktop/README.md](desktop/README.md). Repository checks run through `.github/workflows/repository-checks.yml`. Do not apply a database migration, publish an artifact, or release the app as part of routine code changes.

## Prepare a review

- Summarize the user-visible change and the files affected.
- Report the checks run and their results; identify checks not run.
- Call out setup, compatibility, data, or release steps reviewers should know about.
- Review `git diff` and `git status`; run `git diff --check` for whitespace issues.

Do not commit or push unless explicitly asked.
