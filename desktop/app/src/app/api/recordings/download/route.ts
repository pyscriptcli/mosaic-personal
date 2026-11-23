import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

export const runtime = "nodejs";

function getMosaicMeetingsDir(): string {
  const userHome = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const directory = process.env.MOSAIC_RECORDINGS_DIR
    || (process.env.MOSAIC_DESKTOP === "1" && process.env.MOSAIC_DATA_DIR ? path.join(process.env.MOSAIC_DATA_DIR, "Notetaker", "Recordings") : path.join(userHome, "Documents", "Mosaic Meetings"));
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function getLegacyEchoMeetingsDir() {
  const userHome = process.env.USERPROFILE || process.env.HOME || os.homedir();
  return path.join(userHome, "Documents", "Echo Meetings");
}

function getLegacyMosaicMeetingsDir() {
  const userHome = process.env.USERPROFILE || process.env.HOME || os.homedir();
  return path.join(userHome, "Documents", "Mosaic Meetings");
}

export async function GET(req: NextRequest) {
  try {
    const fileName = req.nextUrl.searchParams.get("fileName");
    if (!fileName) {
      return NextResponse.json({ error: "fileName parameter is required" }, { status: 400 });
    }

    // Prevent directory traversal
    const safeBaseName = path.basename(fileName);
    const directories = [getMosaicMeetingsDir()];
    if (process.env.MOSAIC_DESKTOP === "1" && process.env.MOSAIC_DATA_DIR) directories.push(path.join(process.env.MOSAIC_DATA_DIR, "recordings"));
    directories.push(getLegacyMosaicMeetingsDir(), getLegacyEchoMeetingsDir());
    const filePath = [
      ...directories.map((directory) => path.join(directory, safeBaseName)),
    ].find((candidate) => fs.existsSync(candidate));

    if (!filePath) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const stat = fs.statSync(filePath);
    const ext = path.extname(safeBaseName).toLowerCase();

    let contentType = "application/octet-stream";
    if (ext === ".mp4") contentType = "video/mp4";
    else if (ext === ".webm") contentType = safeBaseName.toLowerCase().includes("video") ? "video/webm" : "audio/webm";
    else if (ext === ".mp3") contentType = "audio/mpeg";
    else if (ext === ".wav") contentType = "audio/wav";
    else if (ext === ".m4a") contentType = "audio/mp4";
    else if (ext === ".ogg") contentType = "audio/ogg";

    const fileStream = fs.createReadStream(filePath);
    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Content-Length", String(stat.size));
    headers.set("Content-Disposition", `attachment; filename="${safeBaseName}"`);

    // Stream the file back
    return new NextResponse(fileStream as any, {
      status: 200,
      headers,
    });
  } catch (error: any) {
    console.error("[Recordings Download API] Error downloading file:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to download recording file" },
      { status: 500 }
    );
  }
}
