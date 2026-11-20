# Repository file placement

Use [the architecture overview](../docs/ARCHITECTURE_OVERVIEW.md) for the desktop system boundaries and [Contributing](../CONTRIBUTING.md) for change and review guidance.

| Work area | Location |
|---|---|
| Electron runtime and OS integration | `desktop/src/` |
| Standalone Mosaic app and APIs | `desktop/app/src/` |
| Desktop scripts and importer | `desktop/scripts/` |
| Windows packaging | `desktop/electron-builder.yml`, `desktop/package.json` |
| Supabase SQL setup and migrations | `supabase/` |
| Desktop plans and operating notes | `docs/` |
| CI and release workflows | `.github/workflows/` |

Keep desktop UI, route handlers, and feature logic inside `desktop/app/`. Update the nearest setup guide when behavior or placement changes. Do not create a second handoff or status log; follow the existing `handoff.md` process when explicitly requested.
