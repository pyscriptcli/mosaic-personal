import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export type LocalFeature = "it-projects" | "meetings" | "tasks" | "my-day" | "notebook" | "notetaker";
export type LocalRecord<T = Record<string, unknown>> = {
  id: string;
  feature: LocalFeature;
  title: string;
  data: T;
  createdAt: string;
  updatedAt: string;
};

const FEATURE_FOLDERS: Record<LocalFeature, string> = {
  "it-projects": "IT Projects",
  meetings: "Meetings",
  tasks: "Notebook",
  "my-day": "Notebook",
  notebook: "Notebook",
  notetaker: "Notetaker",
};

export function isLocalFeature(value: unknown): value is LocalFeature {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(FEATURE_FOLDERS, value);
}

function workspaceRoot() {
  const directory = process.env.MOSAIC_DATA_DIR;
  if (process.env.MOSAIC_DESKTOP !== "1" || !directory) throw new Error("Desktop JSON storage is unavailable.");
  return path.resolve(directory);
}

export function safeFilePart(value: string) {
  return value.normalize("NFKD").replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "").slice(0, 100) || "Untitled";
}

export function dailyFileName(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  if (!Number.isFinite(parsed.getTime())) throw new Error("A valid local calendar date is required.");
  const datePart = parsed.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const weekday = parsed.toLocaleDateString("en-US", { weekday: "short" });
  return `${datePart}, ${weekday}.json`;
}

function directoryFor(feature: LocalFeature) {
  const directory = path.join(workspaceRoot(), FEATURE_FOLDERS[feature]);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function isDaily(feature: LocalFeature) {
  return feature === "my-day" || feature === "notebook";
}

function isDailyFileName(name: string) {
  return /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}, (Sun|Mon|Tue|Wed|Thu|Fri|Sat)\.json$/i.test(name);
}

function updateTombstone(feature: LocalFeature, id: string, deletedAt?: string) {
  const root = workspaceRoot();
  const folder = path.join(root, ".sync");
  const filePath = path.join(folder, "tombstones.json");
  mkdirSync(folder, { recursive: true });
  const current = existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf8")) as Array<{ page: string; id: string; deletedAt: string }> : [];
  const page = FEATURE_FOLDERS[feature];
  const next = current.filter((item) => !(item.page === page && item.id === id));
  if (deletedAt) next.push({ page, id, deletedAt });
  writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8" });
}

function fileFor(feature: LocalFeature, id: string, title: string) {
  const folder = directoryFor(feature);
  if (isDaily(feature)) return path.join(folder, dailyFileName(id));
  return path.join(folder, `${safeFilePart(title)}--${safeFilePart(id)}.json`);
}

function readDocument(filePath: string, feature: LocalFeature): LocalRecord | null {
  if (!existsSync(filePath)) return null;
  const value: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid Mosaic JSON file: ${path.basename(filePath)}`);
  const record = value as Partial<LocalRecord>;
  const schemaVersion = (value as { schemaVersion?: unknown }).schemaVersion;
  if (schemaVersion !== undefined && schemaVersion !== 1) throw new Error(`Unsupported Mosaic JSON version in ${path.basename(filePath)}.`);
  if (typeof record.id !== "string" || typeof record.title !== "string" || !record.data || typeof record.data !== "object" || Array.isArray(record.data)) {
    throw new Error(`Invalid Mosaic record in ${path.basename(filePath)}.`);
  }
  return {
    id: record.id,
    feature,
    title: record.title,
    data: record.data as Record<string, unknown>,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
  };
}

export function listLocalRecords<T = Record<string, unknown>>(feature: LocalFeature): LocalRecord<T>[] {
  const folder = directoryFor(feature);
  return readdirSync(folder).filter((name) => name.toLowerCase().endsWith(".json") && !name.startsWith(".") && (isDaily(feature) ? isDailyFileName(name) : feature === "tasks" ? !isDailyFileName(name) : true))
    .map((name) => readDocument(path.join(folder, name), feature))
    .filter((record): record is LocalRecord => record !== null)
    .map((record) => record as LocalRecord<T>)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function getLocalRecord<T = Record<string, unknown>>(feature: LocalFeature, id: string): LocalRecord<T> | null {
  if (isDaily(feature)) {
    try { return readDocument(fileFor(feature, id, ""), feature) as LocalRecord<T> | null; }
    catch (error) { throw error; }
  }
  const folder = directoryFor(feature);
  const suffix = `--${safeFilePart(id)}.json`;
  const match = readdirSync(folder).find((name) => name.endsWith(suffix));
  return match ? readDocument(path.join(folder, match), feature) as LocalRecord<T> | null : null;
}

export function removeLocalRecordDataFields(feature: LocalFeature, id: string, fields: string[]) {
  const current = getLocalRecord(feature, id);
  if (!current) return false;
  const filePath = fileFor(feature, id, current.title);
  const document = JSON.parse(readFileSync(filePath, "utf8")) as { data: Record<string, unknown>; updatedAt?: string };
  let changed = false;
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(document.data, field)) continue;
    delete document.data[field];
    changed = true;
  }
  if (!changed) return false;
  document.updatedAt = new Date().toISOString();
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  renameSync(tempPath, filePath);
  return true;
}

export function saveLocalRecord<T extends Record<string, unknown>>(feature: LocalFeature, input: { id?: string; title: string; data: T }): LocalRecord<T> {
  const id = input.id?.trim() || randomUUID();
  const title = input.title.trim().slice(0, 500);
  if (!title) throw new Error("Record title must contain 1 to 500 characters.");
  if (!input.data || typeof input.data !== "object" || Array.isArray(input.data)) throw new Error("Record data must be an object.");
  const current = getLocalRecord(feature, id);
  updateTombstone(feature, id);
  const filePath = fileFor(feature, id, title);
  const now = new Date().toISOString();
  const record: LocalRecord<T> = {
    id,
    feature,
    title,
    data: isDaily(feature) && current ? { ...current.data, ...input.data } as T : input.data,
    createdAt: current?.createdAt || now,
    updatedAt: now,
  };
  const payload = JSON.stringify({ schemaVersion: 1, ...record }, null, 2) + "\n";
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, payload, { encoding: "utf8", flag: "wx" });
  renameSync(tempPath, filePath);
  if (current && !isDaily(feature)) {
    const oldPath = fileFor(feature, id, current.title);
    if (oldPath !== filePath && existsSync(oldPath)) unlinkSync(oldPath);
  }
  return record;
}

export function deleteLocalRecord(feature: LocalFeature, id: string) {
  const existing = getLocalRecord(feature, id);
  if (!existing) return false;
  unlinkSync(fileFor(feature, id, existing.title));
  updateTombstone(feature, id, new Date().toISOString());
  return true;
}

export function readWorkspaceJsonFiles() {
  const root = workspaceRoot();
  const files: Array<{ path: string; feature: LocalFeature; record: LocalRecord }> = [];
  for (const feature of Object.keys(FEATURE_FOLDERS) as LocalFeature[]) {
    if (feature === "tasks" || feature === "my-day" || feature === "notebook") continue;
    const folder = path.join(root, FEATURE_FOLDERS[feature]);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder)) {
      const filePath = path.join(folder, name);
      if (!name.toLowerCase().endsWith(".json") || statSync(filePath).isDirectory()) continue;
      const record = readDocument(filePath, feature);
      if (record) files.push({ path: filePath, feature, record });
    }
  }
  const notebookFolder = path.join(root, "Notebook");
  if (existsSync(notebookFolder)) {
    for (const name of readdirSync(notebookFolder)) {
      const filePath = path.join(notebookFolder, name);
      if (!name.toLowerCase().endsWith(".json") || statSync(filePath).isDirectory()) continue;
      const record = readDocument(filePath, "my-day");
      if (record) files.push({ path: filePath, feature: "my-day", record });
    }
  }
  return files;
}
