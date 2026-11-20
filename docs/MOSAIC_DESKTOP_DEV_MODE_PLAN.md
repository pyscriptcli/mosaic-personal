# Mosaic Desktop local development mode plan

## Concept check

Add a checkout-based Electron development workflow so desktop changes can be reviewed locally without packaging or publishing a release. Keep the installed production app and its installer workflow unchanged.

## User flow

1. From `desktop/`, run `npm run dev`.
2. Electron starts the standalone app from `desktop/app/` against Next.js development mode bound to `127.0.0.1`.
3. On first dev launch, choose either an existing Mosaic data folder or an isolated development workspace. The choice is stored in the dev profile.
4. Edit UI or API code and see the Next.js dev server apply the change.
5. Quit Electron; its child development server exits too.
6. For production preview or release packaging, use the existing staged production build workflow.

## Scope now

- Add a `desktop/` development command that launches Electron with the standalone app's Next.js dev server.
- Pass desktop runtime settings and the selected local data paths to the app while listening only on loopback.
- Give development its own Electron preferences, browser session, and single-instance lock so it can run beside the installed app.
- Let the user select an existing Mosaic data folder directly, or use an isolated dev workspace; persist this choice only in the dev profile.
- Stop the dev server when Electron exits, including normal quit and startup failure paths.
- Document the dev workflow and the staged production workflow in `desktop/README.md`.
- Leave packaged production startup and installer packaging on the staged production build path.

## Not in scope

- Publishing GitHub releases as part of local development.
- Changing the production app's profile, data folder behavior, or installer startup.
- Running a separate browser-only development workflow.

## System pieces

- Electron main process: launch and own the Next.js child process, select the dev profile and data folder, and manage shutdown.
- Local app server: choose `next dev` for development and the staged production server for packaged startup; bind both to `127.0.0.1`.
- Standalone app: consume the same desktop runtime settings and local data paths in dev and production.
- Documentation: `desktop/README.md` explains both commands and when to use each.

## Acceptance checks

- [x] `npm run dev` from `desktop/` opens Electron without creating a production package or release.
- [x] A UI source edit appeared through Fast Refresh without restarting Electron.
- [x] An API route edit was served by the running Next.js development server after recompilation.
- [x] Quitting Electron stopped the dev server and released its loopback port.
- [x] The dev app uses the existing `C:\Mosaic` data folder and has separate preferences and single-instance state.
- [x] The production directory packaging command stages and packages the production build, not the Next.js dev server.
- [x] `desktop/README.md` documents both local development and production packaging workflows.

## Risks and checks

- A dev process left behind could hold a port or serve stale code. Check shutdown after normal quit and startup failure.
- Selecting a live Mosaic folder means development can read and write those records. Show the folder choice on first launch and allow an isolated workspace.
- Electron can inherit `ELECTRON_RUN_AS_NODE` from an outer shell, which prevents normal Electron startup. Remove it from the child Electron environment.
- Verify packaging uses the staged production app after dev-mode changes.

## Plan

1. [x] Implement the Electron-owned dev server lifecycle and separate dev profile.
2. [x] Pass runtime settings and the selected data folder through to the local Next.js dev server.
3. [x] Document development and production commands in `desktop/README.md`.
4. [x] Run the acceptance checks above.

## Verification record

- `npm test` in `desktop/`: 5 passed, 0 failed. This covers loopback startup, desktop API response, server shutdown, and cleanup of the per-run dev build and TypeScript config.
- The live Electron window displayed a temporary UI text edit after Fast Refresh. The text was restored after the check.
- A temporary `/api/auth/me` response edit changed from `api-v1` to `api-v2` on the live dev server. The source was restored after the check.
- `npm run dev:quit` exited Electron and Next; the active port closed and no dev artifacts remained.
- Final local launch returned HTTP 200 from `/meetings/notetaker` on `127.0.0.1` and used the selected `C:\Mosaic` folder.
- `npm run dist:dir` completed successfully. `desktop/dist/win-unpacked/resources/local-app/.next/BUILD_ID` matched the staged build ID, and the unpacked app included `Mosaic.exe` and `resources/app.asar`.
- The Next build reports existing dynamic filesystem tracing warnings; packaging still completed.
