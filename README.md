# Mosaic

Mosaic is a repository with a Next.js web app and a local Windows desktop app. Install dependencies in the app you are working on.

## Repository map

| Path | Purpose |
|---|---|
| `frontend/` | Main web app, route handlers, and feature screens |
| `desktop/` | Electron app that runs the web app locally |
| `supabase/` | Database schemas and setup scripts |
| `docs/` and `handoff.md` | Architecture and operating notes |
| `.agents/` | Repository-specific agent skills and assets |
| `output/`, `outputs/` | Retained deliverables and data |

Inside `frontend/src/`, `app/` contains Next.js pages and API routes, `features/` groups feature screens and their code, `components/` holds reusable UI, and `lib/` holds shared integrations and logic.

## Working in this repository

- Start with [Contributing](CONTRIBUTING.md) and the [architecture overview](docs/ARCHITECTURE_OVERVIEW.md).
- Use [AGENTS.md](AGENTS.md) and [agents/INDEX.md](agents/INDEX.md) to find repository guidance and file locations.
- Update [handoff.md](handoff.md) only when a handoff is explicitly requested.
- Check [docs/decisions](docs/decisions/README.md) for recorded repository decisions.

## Requirements

- Node.js 22 (22.12 or newer) and npm.
- Git for source control.
- App-specific environment variables for integrations. Keep secrets in ignored local environment files or deployment secret storage. Never commit credential values.

## Main web app

```powershell
cd frontend
npm ci
npm run dev
```

Useful checks and build commands:

```powershell
npm run lint
npm test
npx tsc --noEmit
npm run build
```

## Windows desktop app

```powershell
cd frontend
npm ci
cd ../desktop
npm ci
npm run dist:win
```

The Phase 1 installer is unsigned and local to the build machine. See [desktop/README.md](desktop/README.md) for local startup and packaging details. Do not publish the pilot installer.

## Database changes

SQL files in `supabase/` define database setup and migrations. Review the target project, SQL effects, and recovery plan before applying them; repository sync and app builds do not apply SQL automatically.

## Repository checks

Pull requests targeting `main` run `.github/workflows/repository-checks.yml`, which validates the frontend and desktop local runtime. The desktop release workflow is separate.

## Artifact handling

Existing tracked files under `output/` and `outputs/` are retained. Build outputs such as `frontend/.next/` and `desktop/dist/` are generated and should not be committed. Review any new deliverable or dataset before deciding to version it.
