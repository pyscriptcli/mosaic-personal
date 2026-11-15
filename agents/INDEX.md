# Repository file-placement guide

Use [the architecture overview](../docs/ARCHITECTURE_OVERVIEW.md) to identify which product area owns a change, and [Contributing](../CONTRIBUTING.md) for the change and review workflow.

## Common locations

| Work area | Location |
| --- | --- |
| Main web app | `frontend/src/` |
| Windows desktop app | `desktop/` |
| Mosaic database schema | `supabase/` |
| Shared plans and operating notes | `docs/` |
| Repository workflows | `.github/` |

For the web app, keep Next.js routes and API handlers under `frontend/src/app/`. Group feature screens, components, and logic under `frontend/src/features/<feature>/`; reserve `frontend/src/components/` for UI reused across features and `frontend/src/lib/` for shared integrations and business logic.

When navigation or setup changes, update the nearest existing README and the root [repository map](../README.md#repository-map). Do not create a second handoff or status log; use [handoff.md](../handoff.md) under its existing workflow.
