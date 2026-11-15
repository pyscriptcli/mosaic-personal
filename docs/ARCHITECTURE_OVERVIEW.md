# Architecture overview

Mosaic is maintained in one repository with a Next.js web app, a Windows desktop app, database setup, and documentation. The root [README](../README.md) is the contributor entry point.

## Main web app

`frontend/` contains the Next.js app and its API routes. Inside `frontend/src/`, `app/` defines route entry points and API handlers, `features/` groups feature screens and feature-owned code, `components/` contains UI shared across features, and `lib/` contains shared integrations and business logic. The web app and API routes run together. See [frontend setup](../frontend/README.md).

## Desktop app

`desktop/` is an Electron Windows app with a standalone Next.js source tree under `desktop/app/`. It starts that app on loopback and packages its production build. The desktop runtime uses a local no-login profile and stores user data in local SQLite and linked files; the hosted web app keeps its existing data flow. Optional ClickUp publishing is a separate desktop integration. See [desktop/README.md](../desktop/README.md).

## Database and external services

`supabase/` holds SQL used by the Mosaic web app. These files describe database structures and policies; editing them does not apply them to a live database. Check the target project, deployment configuration, and migration state before applying changes.

The web app connects to services such as ClickUp and AI/transcription providers. Per-user access and server-side credentials are documented in [frontend/README.md](../frontend/README.md) and [handoff.md](../handoff.md). Treat environment configuration and live service state as deployment-specific.

## Repository guidance and workflow

- [CONTRIBUTING.md](../CONTRIBUTING.md) describes how to locate an area, make a focused change, run checks, and prepare review.
- [AGENTS.md](../AGENTS.md) points agents to shared guidance; tool-specific files should stay short and link back to it.
- [agents/INDEX.md](../agents/INDEX.md) is the repository file-placement guide.
- [handoff.md](../handoff.md) is the rolling handoff. It carries product context and next steps; this overview does not replace it.
- [Repository checks](../.github/workflows/repository-checks.yml) validate the frontend and desktop local runtime on pull requests to `main` and pushes to `main`.
- [docs/](.) contains plans, requirements, and operating notes. Check each document's date and status before treating it as current.
- [Decision records](decisions/README.md) explain when and how to record durable decisions.
