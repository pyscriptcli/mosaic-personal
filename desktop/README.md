# Mosaic desktop app

`desktop/app/` owns the standalone desktop application source. Electron packages this local Next.js app and runs it on loopback. Desktop builds do not read or build `frontend/`.

The desktop app keeps its own source, local profile, APIs and data. The hosted Mosaic web app remains a separate product and keeps its current data flow.

## Build Windows installer

Use Node.js 22.12 or newer and npm on Windows x64.

```powershell
cd desktop
npm ci
npm --prefix app ci
npm run dist:win
```

The installer and checksum go to `desktop/dist/`. Installer is per-user and unsigned for this local pilot. It does not bundle service credentials.

## Run from checkout

```powershell
cd desktop
npm ci
npm --prefix app ci
npm run prepare:local-app
npm start
```

## Desktop behavior

- Electron starts the packaged desktop app on `127.0.0.1`; other devices cannot connect to it.
- The app does not require Mosaic sign-in.
- Ask Echo remains available without sign-in. The Codex chat uses the locally installed Codex CLI; sign in with ChatGPT in the system browser and choose a workspace folder before starting an agent conversation. Codex can write inside that folder and asks before actions that need approval. AI responses require an internet connection.
- User records and preferences are stored in SQLite under Electron's per-user data folder. Meeting recordings are stored beside the database.
- Automatic daily backups keep the latest seven snapshots. Use the Mosaic tray menu to export or restore a backup; restoring replaces the current local workspace.
- Closing the window hides Mosaic in the system tray. Choose **Quit Mosaic** to stop Electron and the local app server.
- **Start with Windows** stays off by default.
- External links open in the system browser.

Do not publish this local pilot installer. Add signed releases and update behavior only in a later desktop phase.
