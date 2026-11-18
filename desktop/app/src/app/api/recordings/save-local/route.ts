import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { saveLocalRecord } from "@/lib/localFirstDatabase";

/**
 * Returns the resolved path to the user's "Documents/Mosaic Meetings" directory.
 */
function getMosaicMeetingsDir(): string {
  if (process.env.MOSAIC_DESKTOP === "1") {
    const userHome = process.env.USERPROFILE || process.env.HOME || os.homedir();
    const directory = process.env.MOSAIC_RECORDINGS_DIR
      ? path.resolve(process.env.MOSAIC_RECORDINGS_DIR)
      : process.env.MOSAIC_DATA_DIR
        ? path.join(process.env.MOSAIC_DATA_DIR, "recordings")
        : path.join(userHome, "Documents", "Mosaic Meetings");
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
    return directory;
  }
  const userHome = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const directory = path.join(userHome, "Documents", "Mosaic Meetings");
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function getLegacyEchoMeetingsDir() {
  const userHome = process.env.USERPROFILE || process.env.HOME || os.homedir();
  return path.join(userHome, "Documents", "Echo Meetings");
}

function listFiles(directory: string) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).flatMap((fileName) => {
    const filePath = path.join(directory, fileName);
    const stat = fs.statSync(filePath);
    return stat.isFile() ? [{ name: fileName, path: filePath, size: stat.size, modifiedAt: stat.mtime.toISOString(), isCheckpoint: fileName.startsWith("CHECKPOINT_") }] : [];
  });
}

/**
 * Format a timestamp safe for filenames: YYYY-MM-DD_HH-mm-ss
 */
function getSafeTimestamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}`;
}

export async function GET() {
  try {
    const directory = getMosaicMeetingsDir();
    const legacyDesktopDirectory = process.env.MOSAIC_DESKTOP === "1" && process.env.MOSAIC_DATA_DIR
      ? path.join(process.env.MOSAIC_DATA_DIR, "recordings")
      : null;
    const legacyWebFiles = process.env.MOSAIC_DESKTOP === "1" ? [] : listFiles(getLegacyEchoMeetingsDir());
    const filesByPath = new Map([...legacyWebFiles, ...(legacyDesktopDirectory ? listFiles(legacyDesktopDirectory) : []), ...listFiles(directory)].map((file) => [path.resolve(file.path), file]));
    const files = [...filesByPath.values()].sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));

    return NextResponse.json({
      directory,
      fileCount: files.length,
      files: files.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()),
    });
  } catch (error) {
    console.error("[Local Save API] Error reading Mosaic Meetings directory:", error);
    return NextResponse.json(
      { error: "Could not read Mosaic Meetings directory" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const sessionId = String(formData.get("sessionId") || `session_${Date.now()}`).replace(/[^a-z0-9_-]/gi, "").slice(0, 80) || `session_${Date.now()}`;
    const status = (formData.get("status") as string) || "completed"; // "completed" | "interrupted" | "checkpoint"
    const mediaType = (formData.get("mediaType") as string) || "audio";
    const requestedFileName = formData.get("fileName") as string | null;
    const customFileName = requestedFileName ? path.basename(requestedFileName).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").slice(0, 240) : null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const directory = getMosaicMeetingsDir();
    const ext = mediaType === "video" || file.type.startsWith("video/") ? "webm" : "webm";
    const buffer = Buffer.from(await file.arrayBuffer());

    let finalFileName: string;

    if (status === "checkpoint") {
      // Rolling checkpoint file (overwrites previous checkpoint for this session)
      finalFileName = `CHECKPOINT_${sessionId}.${ext}`;
    } else if (status === "interrupted") {
      // Interrupted recovery file
      finalFileName = customFileName || `INTERRUPTED_${sessionId}_${getSafeTimestamp()}.${ext}`;
    } else {
      // Final completed meeting recording
      finalFileName = customFileName || `Mosaic_Meeting_${getSafeTimestamp()}_${sessionId.slice(-6)}.${ext}`;

      // Clean up previous rolling checkpoints for this session now that completed file is written
      try {
        const checkpointName = `CHECKPOINT_${sessionId}.${ext}`;
        const checkpointPath = path.join(directory, checkpointName);
        if (fs.existsSync(checkpointPath)) {
          fs.unlinkSync(checkpointPath);
        }
      } catch (err) {
        console.warn("[Local Save API] Failed to clean up checkpoint:", err);
      }
    }

    const targetPath = path.join(directory, finalFileName);
    fs.writeFileSync(targetPath, buffer);

    if (process.env.MOSAIC_DESKTOP === "1" && status === "completed") {
      const title = path.parse(finalFileName).name.replace(/[_-]+/g, " ").trim() || "Meeting Recording";
      saveLocalRecord("notetaker", {
        id: sessionId,
        title,
        data: {
          date: new Date().toLocaleDateString("en-CA"),
          fileName: finalFileName,
          relativePath: `Recordings/${finalFileName}`,
          mediaType: mediaType === "video" || file.type.startsWith("video/") ? "video" : "audio",
          sizeBytes: buffer.length,
          savedAt: new Date().toISOString(),
        },
      });
    }

    console.log(`[Local Save API] Saved recording (${status}): ${targetPath} [${buffer.length} bytes]`);

    return NextResponse.json({
      success: true,
      directory,
      fileName: finalFileName,
      filePath: targetPath,
      sizeBytes: buffer.length,
      status,
    });
  } catch (error) {
    console.error("[Local Save API] Failed to save recording locally:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save file locally" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const fileName = req.nextUrl.searchParams.get("fileName");
    if (!fileName) {
      return NextResponse.json({ error: "fileName parameter is required" }, { status: 400 });
    }

    const safeBaseName = path.basename(fileName);
    const filePaths = [path.join(getMosaicMeetingsDir(), safeBaseName), ...(process.env.MOSAIC_DESKTOP === "1" ? [] : [path.join(getLegacyEchoMeetingsDir(), safeBaseName)])]
      .filter((candidate) => fs.existsSync(/*turbopackIgnore: true*/ candidate));

    if (filePaths.length) {
      filePaths.forEach((filePath) => fs.unlinkSync(filePath));
      return NextResponse.json({ success: true, fileName: safeBaseName });
    }

    return NextResponse.json({ error: "File not found" }, { status: 404 });
  } catch (error: any) {
    console.error("[Local Save API] Failed to delete recording file:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete file" },
      { status: 500 }
    );
  }
}

