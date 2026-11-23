import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { listLocalRecords, saveLocalRecord } from "@/lib/localFirstDatabase";

export type ConversionState = "queued" | "converting" | "ready" | "failed";
export type ConversionJob = {
  id: string;
  sourcePath: string;
  outputPath: string;
  mediaType: "audio" | "video";
  state: ConversionState;
  progress: number;
  cleanupPath?: string;
  replacementBackupPath?: string;
  stagedOutputPath?: string;
  error?: string;
  updatedAt: string;
};

type Manifest = { version: 1; jobs: ConversionJob[]; paused: boolean };
const jobsById = new Map<string, ConversionJob>();
let manifest: Manifest | null = null;
let workerRunning = false;

function dirs() {
  const userHome = process.env.USERPROFILE || process.env.HOME || process.cwd();
  const primary = process.env.MOSAIC_RECORDINGS_DIR
    || (process.env.MOSAIC_DATA_DIR ? path.join(process.env.MOSAIC_DATA_DIR, "Notetaker", "Recordings") : path.join(userHome, "Documents", "Mosaic Meetings"));
  const candidates = [primary];
  if (process.env.MOSAIC_DATA_DIR) candidates.push(path.join(process.env.MOSAIC_DATA_DIR, "recordings"));
  candidates.push(path.join(userHome, "Documents", "Mosaic Meetings"));
  candidates.push(path.join(userHome, "Documents", "Echo Meetings"));
  return [...new Set(candidates.map((item) => path.resolve(item)))];
}

function manifestPath() {
  const base = process.env.MOSAIC_INTERNAL_DATA_DIR || path.join(process.env.MOSAIC_DATA_DIR || process.cwd(), ".internal");
  return path.join(base, "recording-conversions.json");
}

function loadManifest(): Manifest {
  if (manifest) return manifest;
  try {
    const value = JSON.parse(fs.readFileSync(manifestPath(), "utf8")) as Manifest;
    manifest = { version: 1, jobs: Array.isArray(value.jobs) ? value.jobs : [], paused: value.paused === true };
  } catch {
    manifest = { version: 1, jobs: [], paused: false };
  }
  for (const job of manifest.jobs) {
    if (job.state === "converting") job.state = "queued";
    jobsById.set(job.id, job);
  }
  return manifest;
}

function persist() {
  const current = loadManifest();
  const target = manifestPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ ...current, jobs: [...jobsById.values()] }, null, 2)}\n`, { flag: "wx" });
  fs.renameSync(temp, target);
}

function executable(name: "ffmpeg" | "ffprobe") {
  const configured = process.env[name === "ffmpeg" ? "MOSAIC_FFMPEG_PATH" : "MOSAIC_FFPROBE_PATH"];
  if (!configured || !fs.existsSync(configured)) throw new Error(`${name} is unavailable. Restart Mosaic or reinstall the app to restore its bundled media tools.`);
  return configured;
}

function run(file: string, args: string[], onLine?: (line: string) => void) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr = (stderr + text).slice(-12_000);
      for (const line of text.split(/\r?\n/)) onLine?.(line);
    });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `${path.basename(file)} exited with code ${code}`)));
  });
}

async function probe(filePath: string) {
  const stdout = await run(executable("ffprobe"), ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath]);
  return JSON.parse(stdout) as { streams: Array<{ codec_type: string; codec_name: string }>; format?: { duration?: string } };
}

function updateRecordingRecords(oldName: string, newName: string, mediaType: "audio" | "video", sizeBytes: number) {
  if (process.env.MOSAIC_DESKTOP !== "1") return;
  for (const feature of ["notetaker", "meetings"] as const) {
    for (const record of listLocalRecords<Record<string, unknown>>(feature)) {
      const hasReference = JSON.stringify(record.data).includes(oldName);
      if (!hasReference) continue;
      const rewrite = (value: unknown, fieldName?: string): unknown => {
        if (typeof value === "string") {
          if (fieldName === "recording_format") return path.extname(newName).slice(1).toUpperCase();
          return value.includes(oldName) ? value.replaceAll(oldName, newName) : value;
        }
        if (Array.isArray(value)) return value.map((child) => rewrite(child, fieldName));
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child, key)]));
        return value;
      };
      const data = rewrite(record.data) as Record<string, unknown>;
      if (feature === "notetaker" && hasReference) Object.assign(data, { fileName: newName, relativePath: `Recordings/${newName}`, mediaType, sizeBytes, format: path.extname(newName).slice(1), savedAt: new Date().toISOString(), conversionState: "ready", conversionProgress: 100, conversionError: null });
      saveLocalRecord(feature, { id: record.id, title: record.title, data });
    }
  }
}

function updateConversionMetadata(sourcePath: string, values: { conversionState: ConversionState; conversionProgress: number; conversionError?: string | null }) {
  if (process.env.MOSAIC_DESKTOP !== "1") return;
  const sourceName = path.basename(sourcePath);
  for (const record of listLocalRecords<Record<string, unknown>>("notetaker")) {
    if (record.data.fileName !== sourceName && record.data.relativePath !== `Recordings/${sourceName}`) continue;
    saveLocalRecord("notetaker", { id: record.id, title: record.title, data: { ...record.data, ...values } });
  }
}

async function convert(job: ConversionJob) {
  const ffmpeg = executable("ffmpeg");
  if (!job.replacementBackupPath && job.stagedOutputPath && fs.existsSync(job.stagedOutputPath)) {
    fs.unlinkSync(job.stagedOutputPath);
    job.stagedOutputPath = undefined;
    persist();
  }
  if (job.replacementBackupPath) {
    let backupExists = fs.existsSync(job.replacementBackupPath);
    const stagedExists = !!job.stagedOutputPath && fs.existsSync(job.stagedOutputPath);
    let published = false;
    if (!backupExists && stagedExists && fs.existsSync(job.sourcePath)) {
      fs.renameSync(job.sourcePath, job.replacementBackupPath);
      backupExists = true;
      fs.renameSync(job.stagedOutputPath!, job.sourcePath);
      published = true;
    } else if (backupExists && !fs.existsSync(job.sourcePath)) {
      if (stagedExists) {
        fs.renameSync(job.stagedOutputPath!, job.sourcePath);
        published = true;
      } else {
        fs.renameSync(job.replacementBackupPath, job.sourcePath);
        backupExists = false;
      }
    } else if (backupExists && fs.existsSync(job.sourcePath)) {
      published = true;
    }
    if (published && fs.existsSync(job.replacementBackupPath)) fs.unlinkSync(job.replacementBackupPath);
    if (published) {
      updateRecordingRecords(path.basename(job.sourcePath), path.basename(job.outputPath), job.mediaType, fs.statSync(job.outputPath).size);
      if (job.cleanupPath && fs.existsSync(job.cleanupPath)) fs.unlinkSync(job.cleanupPath);
      job.state = "ready";
      job.progress = 100;
      job.updatedAt = new Date().toISOString();
    }
    job.replacementBackupPath = undefined;
    job.stagedOutputPath = undefined;
    persist();
    if (job.state === "ready") return;
  }
  const sourceStat = fs.statSync(job.sourcePath);
  const sourceProbe = await probe(job.sourcePath);
  const duration = Number(sourceProbe.format?.duration || 0);
  if (!(duration > 0)) throw new Error("The source recording has no readable duration.");
  const replaceInPlace = path.resolve(job.sourcePath) === path.resolve(job.outputPath);
  if (!replaceInPlace && fs.existsSync(job.outputPath)) {
    const existing = await probe(job.outputPath);
    const streams = existing.streams || [];
    const compatible = job.mediaType === "video"
      ? streams.some((stream) => stream.codec_type === "video" && stream.codec_name === "h264") && streams.filter((stream) => stream.codec_type === "audio").every((stream) => stream.codec_name === "aac")
      : streams.some((stream) => stream.codec_type === "audio" && stream.codec_name === "mp3");
    const existingDuration = Number(existing.format?.duration || 0);
    if (!compatible || !(existingDuration > 0) || Math.abs(existingDuration - duration) > Math.max(2, duration * 0.02)) {
      throw new Error("A different file already uses the converted recording name. The original recording is still available.");
    }
    await run(ffmpeg, ["-v", "error", "-i", job.outputPath, "-f", "null", "-"]);
    fs.utimesSync(job.outputPath, sourceStat.atime, sourceStat.mtime);
    updateRecordingRecords(path.basename(job.sourcePath), path.basename(job.outputPath), job.mediaType, fs.statSync(job.outputPath).size);
    fs.unlinkSync(job.sourcePath);
    if (job.cleanupPath && fs.existsSync(job.cleanupPath)) fs.unlinkSync(job.cleanupPath);
    job.state = "ready";
    job.progress = 100;
    job.updatedAt = new Date().toISOString();
    persist();
    return;
  }
  const tempPath = `${job.outputPath}.${randomUUID()}.partial`;
  const outputIsVideo = job.mediaType === "video";
  const args = ["-hide_banner", "-y", "-i", job.sourcePath, "-map_metadata", "0", "-progress", "pipe:2", "-nostats"];
  if (outputIsVideo) {
    args.push("-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-f", "mp4", tempPath);
  } else {
    args.push("-map", "0:a:0", "-vn", "-c:a", "libmp3lame", "-b:a", "128k", "-f", "mp3", tempPath);
  }
  job.state = "converting";
  job.progress = 0;
  job.error = undefined;
  job.updatedAt = new Date().toISOString();
  job.stagedOutputPath = tempPath;
  updateConversionMetadata(job.sourcePath, { conversionState: "converting", conversionProgress: 0, conversionError: null });
  persist();
  let lastSavedProgress = 0;
  await run(ffmpeg, args, (line) => {
    const match = line.match(/^out_time_ms=(\d+)/);
    if (!match) return;
    job.progress = Math.max(job.progress, Math.min(99, Math.floor((Number(match[1]) / 1_000_000 / duration) * 100)));
    job.updatedAt = new Date().toISOString();
    if (job.progress - lastSavedProgress >= 10) {
      lastSavedProgress = job.progress;
      updateConversionMetadata(job.sourcePath, { conversionState: "converting", conversionProgress: job.progress });
    }
    persist();
  });
  const result = await probe(tempPath);
  const streams = result.streams || [];
  const hasExpected = outputIsVideo
    ? streams.some((stream) => stream.codec_type === "video" && stream.codec_name === "h264") && streams.filter((stream) => stream.codec_type === "audio").every((stream) => stream.codec_name === "aac")
    : streams.some((stream) => stream.codec_type === "audio" && stream.codec_name === "mp3");
  if (!hasExpected || !(Number(result.format?.duration || 0) > 0)) throw new Error("The converted recording failed its codec or duration check.");
  const outputDuration = Number(result.format?.duration || 0);
  if (Math.abs(outputDuration - duration) > Math.max(2, duration * 0.02)) throw new Error("The converted recording duration differs too much from the original.");
  await run(ffmpeg, ["-v", "error", "-i", tempPath, "-f", "null", "-"]);
  if (replaceInPlace) {
    const backupPath = `${job.sourcePath}.${randomUUID()}.original`;
    job.replacementBackupPath = backupPath;
    persist();
    fs.renameSync(job.sourcePath, backupPath);
    try {
      fs.renameSync(tempPath, job.outputPath);
    } catch (error) {
      fs.renameSync(backupPath, job.sourcePath);
      job.replacementBackupPath = undefined;
      job.stagedOutputPath = undefined;
      persist();
      throw error;
    }
  } else {
    fs.renameSync(tempPath, job.outputPath);
    job.stagedOutputPath = undefined;
  }
  fs.utimesSync(job.outputPath, sourceStat.atime, sourceStat.mtime);
  const oldName = path.basename(job.sourcePath);
  const newName = path.basename(job.outputPath);
  const sizeBytes = fs.statSync(job.outputPath).size;
  updateRecordingRecords(oldName, newName, job.mediaType, sizeBytes);
  if (!replaceInPlace) fs.unlinkSync(job.sourcePath);
  if (job.replacementBackupPath && fs.existsSync(job.replacementBackupPath)) fs.unlinkSync(job.replacementBackupPath);
  if (job.cleanupPath && fs.existsSync(job.cleanupPath)) fs.unlinkSync(job.cleanupPath);
  job.replacementBackupPath = undefined;
  job.stagedOutputPath = undefined;
  job.state = "ready";
  job.progress = 100;
  job.updatedAt = new Date().toISOString();
  persist();
}

function startWorker() {
  const current = loadManifest();
  if (workerRunning || current.paused) return;
  workerRunning = true;
  void (async () => {
    try {
      while (!loadManifest().paused) {
        const job = [...jobsById.values()].find((candidate) => candidate.state === "queued");
        if (!job) break;
        try {
          await convert(job);
        } catch (error) {
          if (!job.replacementBackupPath && job.stagedOutputPath && fs.existsSync(job.stagedOutputPath)) fs.unlinkSync(job.stagedOutputPath);
          if (!job.replacementBackupPath) job.stagedOutputPath = undefined;
          job.state = "failed";
          job.error = error instanceof Error ? error.message : "Recording conversion failed.";
          job.updatedAt = new Date().toISOString();
          updateConversionMetadata(job.sourcePath, { conversionState: "failed", conversionProgress: job.progress, conversionError: job.error });
          persist();
        }
      }
    } finally {
      workerRunning = false;
    }
  })();
}

function enqueue(sourcePath: string, mediaType: "audio" | "video", outputName?: string, cleanupPath?: string) {
  const absoluteSource = path.resolve(sourcePath);
  const ext = mediaType === "video" ? ".mp4" : ".mp3";
  const outputPath = outputName ? path.join(path.dirname(absoluteSource), outputName) : mediaType === "video" && path.extname(absoluteSource).toLowerCase() === ".mp4" ? absoluteSource : path.join(path.dirname(absoluteSource), `${path.parse(absoluteSource).name}${ext}`);
  let job = [...jobsById.values()].find((candidate) => candidate.sourcePath === absoluteSource && candidate.outputPath === outputPath);
  if (!job || job.state === "failed") {
    job = { id: randomUUID(), sourcePath: absoluteSource, outputPath, mediaType, state: "queued", progress: 0, cleanupPath, updatedAt: new Date().toISOString() };
    jobsById.set(job.id, job);
  }
  persist();
  updateConversionMetadata(absoluteSource, { conversionState: "queued", conversionProgress: 0, conversionError: null });
  startWorker();
  return job;
}

export function enqueueRecordingConversion(sourcePath: string, mediaType: "audio" | "video", outputName?: string, cleanupPath?: string) {
  return enqueue(sourcePath, mediaType, outputName, cleanupPath);
}

export function listConversionJobs() {
  loadManifest();
  return [...jobsById.values()].map((job) => ({ ...job }));
}

export function isConversionPaused() {
  return loadManifest().paused;
}

export function findConversionJob(id: string) {
  loadManifest();
  const job = jobsById.get(id) || [...jobsById.values()].find((candidate) => candidate.sourcePath === id || path.basename(candidate.sourcePath) === id);
  return job ? { ...job } : null;
}

export function controlConversionJobs(action: "scan" | "pause" | "resume" | "retry", id?: string) {
  const current = loadManifest();
  if (action === "pause") current.paused = true;
  if (action === "resume") current.paused = false;
  if (action === "scan") {
    for (const directory of dirs()) {
      if (!fs.existsSync(directory)) continue;
      for (const name of fs.readdirSync(directory)) {
        if (!/\.(webm|mp4|mp3|m4a|wav|ogg|mov|avi)$/i.test(name) || /^CHECKPOINT_/i.test(name)) continue;
        const sourcePath = path.join(directory, name);
        if ([...jobsById.values()].some((job) => job.sourcePath === sourcePath)) continue;
        try {
          const source = probe(sourcePath);
          void source.then((metadata) => {
            const streams = metadata.streams || [];
            const video = streams.find((stream) => stream.codec_type === "video");
            const mediaType = video ? "video" : "audio";
            if (path.extname(name).toLowerCase() === ".mp3" && !video && streams.some((stream) => stream.codec_type === "audio" && stream.codec_name === "mp3")) return;
            if (path.extname(name).toLowerCase() === ".mp4" && video?.codec_name === "h264" && streams.filter((stream) => stream.codec_type === "audio").every((stream) => stream.codec_name === "aac")) return;
            enqueue(sourcePath, mediaType);
          }).catch((error) => {
            const job = enqueue(sourcePath, /video/i.test(name) ? "video" : "audio");
            job.state = "failed";
            job.error = error instanceof Error ? error.message : "Could not inspect recording.";
            persist();
          });
        } catch {
          // Missing ffprobe leaves files intact and reports an actionable failure through queued job.
          const job = enqueue(sourcePath, /video/i.test(name) ? "video" : "audio");
          job.state = "failed";
          job.error = "The recording could not be inspected. The original file is still available.";
          persist();
        }
      }
    }
  }
  if (action === "retry" && id) {
    const job = jobsById.get(id) || [...jobsById.values()].find((candidate) => path.basename(candidate.sourcePath) === id);
    if (job && fs.existsSync(job.sourcePath)) {
      job.state = "queued";
      job.progress = 0;
      job.error = undefined;
      job.updatedAt = new Date().toISOString();
      updateConversionMetadata(job.sourcePath, { conversionState: "queued", conversionProgress: 0, conversionError: null });
    }
  }
  persist();
  startWorker();
  return { paused: current.paused, jobs: listConversionJobs() };
}
