# Mosaic Desktop

Mosaic Desktop is a local-first Windows app built with Electron and a standalone Next.js app. It keeps meeting, notebook, notetaker, and project records on this device, with optional Supabase and ClickUp sync.

## Repository map

| Path | Purpose |
|---|---|
| `desktop/` | Electron runtime, standalone app, installer scripts, and desktop setup guide |
| `supabase/` | SQL setup and migrations used by desktop sync features |
| `docs/` | Desktop architecture, implementation notes, and operating guidance |
| `.github/` | Repository checks |
| `agents/` and `.agents/` | Repository navigation and agent guidance |

## Develop and build

Use Node.js 22.12 or newer and npm. Follow [desktop setup and packaging](desktop/README.md).

```powershell
cd desktop
npm ci
npm --prefix app ci
npm run prepare:local-app
npm start
```

Build the Windows installer with `npm run dist:win` from `desktop/`.

## Checks

The desktop app checks are defined in `.github/workflows/repository-checks.yml`. They validate the Electron runtime, build the standalone app, stage the local runtime, and run desktop tests.

## Integrations and data

The app runs locally without cloud credentials. Configure AI providers and optional sync in Mosaic Settings. SQL files under `supabase/` are setup artifacts; review their effects and recovery plan before applying them to a project. Builds do not apply SQL automatically.

Keep local environment files, credentials, personal records, and generated build output out of Git. Existing tracked deliverables under `output/` and `outputs/` are retained.
