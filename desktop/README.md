# Mosaic desktop app

`desktop/app/` owns the standalone app source. Electron packages this local Next.js app and runs it on loopback.

The desktop app keeps its own source, local profile, APIs and data. Its records are plain JSON files in a `Mosaic` folder chosen on first launch.

## Build Windows installer

Use Node.js 22.12 or newer and npm on Windows x64.

```powershell
cd desktop
npm ci
npm --prefix app ci
npm run dist:win
```

The installer and checksum go to `desktop/dist/`. Installer is per-user and currently unsigned. It does not bundle service credentials.

## Run from checkout

```powershell
cd desktop
npm ci
npm --prefix app ci
npm run prepare:local-app
npm start
```

## Live local development

Use the Electron development mode when changing the app. It starts `desktop/app/` with Next.js development mode on loopback and shows the app in its desktop window. UI edits update with Fast Refresh; API edits are picked up by the dev server. No production build or GitHub release is needed.

```powershell
cd desktop
npm ci
npm --prefix app ci
npm run dev
```

Keep the terminal open while Mosaic is running to see compile and runtime messages. Quit Mosaic from its tray menu; the development server stops with Electron. Use `npm start` only after `npm run prepare:local-app` when you want to preview the staged production build.

To ask a running development instance to quit from another terminal, run `npm run dev:quit` from `desktop/`.

Development mode uses a separate app profile, browser session, and single-instance lock, so it can run beside the installed app. On first launch choose **Choose existing Mosaic folder** and select the data folder itself (for example, `Documents\\Mosaic`) to use those local records. Choose **Create development workspace** to keep a separate dev data set. You can change the selected folder later in Settings. Development may update workspace files you select, so choose the correct folder deliberately.

## Desktop behavior

- Electron starts the packaged desktop app on `127.0.0.1`; other devices cannot connect to it.
- Mosaic opens directly to the local workspace.
- Choose a parent folder on first launch. Mosaic creates `Mosaic/IT Projects`, `Mosaic/Meetings`, `Mosaic/Notebook`, and `Mosaic/Notetaker` beneath it. Do not choose a parent whose `Mosaic/` folder is an existing Git checkout; the app asks you to select another folder. Notebook entries use one JSON file per day, named like `November 18, 2026, Wed.json`.
- The Explorer sidebar starts expanded at 228 px. Collapse it to a 48 px icon rail or drag its edge from 180–420 px; Mosaic remembers both settings.
- Notebook Daily starts with equal-width Tasks and Day notes panes. Drag the divider to resize either pane from 15% to 85%; Mosaic remembers your chosen split. Use the pane tabs when the window is too narrow for two columns.
- Use the Notebook header to switch Daily, Weekly, and Lists, followed by the Daily date controls. Add task sits beside the selected date; in Weekly and Lists, it stays in the header. To do includes overdue tasks; Done shows completed tasks for the selected view. High tasks sort first by default, but dragging lets you set any order across priority levels. Only High displays a priority badge.
- Drag from the handle beside each checkbox; use the handle's arrow keys for keyboard reordering. Task rows stay compact and have no separate up/down buttons.
- Unfinished tasks appear in later Daily and Weekly To do views until completed. Repeated dated snapshots collapse to the latest task record so each carried task appears once. Tasks stay stored on their original Notebook date; Lists shows each task once.
- Notebook reminders start off for profiles without a saved choice. Enable them from the reminder bell. The popup separates Overdue from To do, lets you complete or reopen tasks, and shares task ordering with Notebook; choose one to five hours from the Snooze menu.
- Records save locally first. When Supabase is configured in **Settings**, Mosaic syncs JSON records automatically and offers **Sync now**. Video and audio files stay on this device and are excluded from cloud sync.
- To import legacy `TasksData` files once, run `node scripts/import-tasksdata.cjs --source <TasksData folder> --workspace <Mosaic folder> --apply` from `desktop/`. Run without `--apply` first to review the import plan. Task dates use `carriedForwardTo` or the source filename; notes go to Day Notes. Deleted tasks and empty source files are skipped, and a completion marker prevents a second import.
- To enable sync, create a private Supabase project, run [`supabase/mosaic_workspace_sync.sql`](../supabase/mosaic_workspace_sync.sql) in its SQL editor, then enter its project URL and secret key in Mosaic Settings. The secret key is encrypted with Windows secure storage and used only by Electron's main process. SQL is not applied automatically.
- Ask Echo opens as a nonblocking, resizable right dock; pages remain interactive beside it. The header keeps Workspace and New chat beside the title. Mention an available skill by name in your prompt to apply it. The compact composer keeps Markdown formatting tools behind its plus button, and the activity timeline shows agent steps with an elapsed HH:MM:SS timer. Codex can create requested reports under `Outputs/` and create Notebook, meeting, and IT Project records through Mosaic's local APIs; successful direct creations show an Undo action. Workspace writes remain subject to Codex approvals. AI responses require an internet connection.
- Codex is instructed to archive removals in `C:\Mosaic\Recycle Bin` and retain them indefinitely. This is best effort: native CLI commands can still permanently delete files, so Mosaic cannot guarantee that every deletion is recoverable.
- AI provider keys and local preferences are stored under Electron's per-user data folder. AI provider keys use Windows secure storage.
- In desktop Settings, import Groq transcription keys from `desktop/app/.env`. The app encrypts the values in its local profile and passes them only to the transcription route. `.env` files are not packaged or committed. The desktop chatbot uses the locally installed Codex CLI.
- Automatic daily backups keep the latest seven snapshots of the `Mosaic` folder and run asynchronously so the desktop window stays responsive. Use the Mosaic tray menu to export or restore a backup; restoring replaces the current local workspace.
- Closing the window hides Mosaic in the system tray. Choose **Quit Mosaic** to stop Electron and the local app server.
- **Start with Windows** stays off by default.
- External links open in the system browser.

## Automatic updates

The installed Windows app checks the GitHub prereleases on startup and every four hours. Use **Help → Check for updates** or the status bar to check on demand. When an update downloads, choose **Restart to update** to install it.

Updates use the unsigned NSIS installer. The updater disables Windows publisher-signature verification until the app is code signed; releases are fetched over HTTPS from the configured GitHub repository. Do not distribute builds through untrusted release locations.

To publish an update, increment `version` in `package.json`, build with `electron-builder --win nsis --x64`, and publish the generated `latest.yml`, installer, and blockmap as assets on a GitHub prerelease.
