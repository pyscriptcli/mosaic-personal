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

The installer and checksum go to `desktop/dist/`. Installer is per-user and currently unsigned. It does not bundle service credentials.

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
- Mosaic opens directly to the local workspace.
- Ask Echo is available in the local workspace. Codex chat uses the locally installed Codex CLI when it is already configured on this device; choose a workspace folder before starting an agent conversation. Codex can write inside that folder and asks before actions that need approval. AI responses require an internet connection.
- User records and preferences are stored in SQLite under Electron's per-user data folder. Meeting recordings are stored beside the database.
- Automatic daily backups keep the latest seven snapshots. Use the Mosaic tray menu to export or restore a backup; restoring replaces the current local workspace.
- Closing the window hides Mosaic in the system tray. Choose **Quit Mosaic** to stop Electron and the local app server.
- **Start with Windows** stays off by default.
- External links open in the system browser.

## Automatic updates

The installed Windows app checks the GitHub prereleases on startup and every four hours. Use **Help → Check for updates** or the status bar to check on demand. When an update downloads, choose **Restart to update** to install it.

Updates use the unsigned NSIS installer. The updater disables Windows publisher-signature verification until the app is code signed; releases are fetched over HTTPS from the configured GitHub repository. Do not distribute builds through untrusted release locations.

To publish an update, increment `version` in `package.json`, build with `electron-builder --win nsis --x64`, and publish the generated `latest.yml`, installer, and blockmap as assets on a GitHub prerelease.
