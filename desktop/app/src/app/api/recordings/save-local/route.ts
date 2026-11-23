import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { saveLocalRecord } from "@/lib/localFirstDatabase";
import { controlConversionJobs, enqueueRecordingConversion, isConversionPaused, listConversionJobs } from "@/lib/recordingConversion";

export const runtime = "nodejs";

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

function getLegacyMosaicMeetingsDir() {
  const userHome = process.env.USERPROFILE || process.env.HOME || os.homedir();
  return path.join(userHome, "Documents", "Mosaic Meetings");
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

function publishTempFile(tempPath: string, targetPath: string, replaceExisting: boolean) {
  if (!fs.existsSync(targetPath)) {
    fs.renameSync(tempPath, targetPath);
    return true;
  }
  if (!replaceExisting) return false;
  const backupPath = `${targetPath}.${Date.now()}.backup`;
  fs.renameSync(targetPath, backupPath);
  try {
    fs.renameSync(tempPath, targetPath);
    fs.unlinkSync(backupPath);
    return true;
  } catch (error) {
    if (!fs.existsSync(targetPath) && fs.existsSync(backupPath)) fs.renameSync(backupPath, targetPath);
    throw error;
  }
}

export async function GET() {
  try {
    controlConversionJobs("scan");
    const directory = getMosaicMeetingsDir();
    const legacyDesktopDirectory = process.env.MOSAIC_DESKTOP === "1" && process.env.MOSAIC_DATA_DIR
      ? path.join(process.env.MOSAIC_DATA_DIR, "recordings")
      : null;
    const filesByName = new Map<string, ReturnType<typeof listFiles>[number]>();
    for (const file of [...listFiles(directory), ...(legacyDesktopDirectory ? listFiles(legacyDesktopDirectory) : []), ...listFiles(getLegacyMosaicMeetingsDir()), ...listFiles(getLegacyEchoMeetingsDir())]) {
      if (!filesByName.has(file.name.toLowerCase())) filesByName.set(file.name.toLowerCase(), file);
    }
    const jobs = listConversionJobs();
    const files = [...filesByName.values()].map((file) => {
      const job = jobs.find((candidate) => path.resolve(candidate.sourcePath) === path.resolve(file.path));
      const isFinalFormat = /\.(mp3|mp4)$/i.test(file.name);
      return { ...file, conversionState: job?.state || (isFinalFormat ? "ready" : "queued"), conversionProgress: job?.progress || (isFinalFormat ? 100 : 0), conversionError: job?.error, conversionJobId: job?.id };
    });
    files.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));

    return NextResponse.json({
      directory,
      fileCount: files.length,
      conversionsPaused: isConversionPaused(),
      files,
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
    const mediaType = formData.get("mediaType") === "video" || file?.type.startsWith("video/") ? "video" : "audio";
    const requestedFileName = formData.get("fileName") as string | null;
    let notes: unknown[] = [];
    try {
      const rawNotes = formData.get("notes");
      if (typeof rawNotes === "string") {
        const parsed = JSON.parse(rawNotes);
        if (Array.isArray(parsed)) notes = parsed.slice(0, 500).flatMap((note) => note && typeof note.text === "string" ? [{ id: String(note.id || "").slice(0, 100), timestamp: String(note.timestamp || "").slice(0, 40), text: note.text.slice(0, 10_000) }] : []);
      }
    } catch { /* malformed optional notes are ignored */ }
    const customFileName = requestedFileName ? path.basename(requestedFileName).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").slice(0, 240) : null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const directory = getMosaicMeetingsDir();
    let finalFileName: string;

    if (status === "checkpoint") {
      // Rolling checkpoint file (overwrites previous checkpoint for this session)
      finalFileName = `CHECKPOINT_${sessionId}.webm`;
    } else if (status === "interrupted") {
      // Interrupted recovery file
      finalFileName = customFileName || `INTERRUPTED_${sessionId}_${getSafeTimestamp()}.webm`;
    } else {
      // Final completed meeting recording
      finalFileName = customFileName || `Mosaic_Meeting_${getSafeTimestamp()}_${sessionId.slice(-6)}.webm`;
    }

    const targetPath = path.join(directory, finalFileName);
    const tempPath = `${targetPath}.${Date.now()}.partial`;
    let published: boolean;
    try {
      await pipeline(Readable.fromWeb(file.stream() as any), createWriteStream(tempPath, { flags: "wx" }));
      published = publishTempFile(tempPath, targetPath, status === "checkpoint");
    } catch (error) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      throw error;
    }
    if (!published) fs.unlinkSync(tempPath);
    const savedSizeBytes = fs.statSync(targetPath).size;

    if (process.env.MOSAIC_DESKTOP === "1" && status === "completed") {
      const title = path.parse(finalFileName).name.replace(/[_-]+/g, " ").trim() || "Meeting Recording";
      saveLocalRecord("notetaker", {
        id: sessionId,
        title,
        data: {
          date: new Date().toLocaleDateString("en-CA"),
          fileName: finalFileName,
          relativePath: `Recordings/${finalFileName}`,
          mediaType,
          sizeBytes: savedSizeBytes,
          savedAt: new Date().toISOString(),
          ...(notes.length ? { notes } : {}),
        },
      });
    }

    if (status === "completed" && ![".mp3", ".mp4"].includes(path.extname(finalFileName).toLowerCase())) {
      const job = enqueueRecordingConversion(targetPath, mediaType, undefined, path.join(directory, `CHECKPOINT_${sessionId}.webm`));
      // Keep the rolling checkpoint until the final conversion has been validated.
      return NextResponse.json({ success: true, directory, fileName: finalFileName, filePath: targetPath, sizeBytes: savedSizeBytes, status: "converting", conversionJobId: job.id }, { status: 202 });
    }

    // Only remove checkpoints after a completed final recording is durably saved.
    if (status === "completed") {
      try { fs.unlinkSync(path.join(directory, `CHECKPOINT_${sessionId}.webm`)); } catch { /* no checkpoint to remove */ }
    }

    console.log(`[Local Save API] Saved recording (${status}): ${targetPath} [${savedSizeBytes} bytes]`);

    return NextResponse.json({
      success: true,
      directory,
      fileName: finalFileName,
      filePath: targetPath,
      sizeBytes: savedSizeBytes,
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
    const directories = [getMosaicMeetingsDir()];
    if (process.env.MOSAIC_DESKTOP === "1" && process.env.MOSAIC_DATA_DIR) directories.push(path.join(process.env.MOSAIC_DATA_DIR, "recordings"));
    directories.push(getLegacyMosaicMeetingsDir(), getLegacyEchoMeetingsDir());
    const filePath = directories.map((directory) => path.join(directory, safeBaseName))
      .find((candidate) => fs.existsSync(/*turbopackIgnore: true*/ candidate));

    if (filePath) {
      fs.unlinkSync(filePath);
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

