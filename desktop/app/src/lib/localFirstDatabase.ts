import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type LocalFeature = "it-projects" | "meetings" | "tasks" | "my-day" | "notebook" | "echo";
export type LocalRecord<T = Record<string, unknown>> = {
  id: string;
  feature: LocalFeature;
  title: string;
  data: T;
  createdAt: string;
  updatedAt: string;
  clickUpId: string | null;
  clickUpListId: string | null;
  publishedAt: string | null;
};

const FEATURES = new Set<LocalFeature>(["it-projects", "meetings", "tasks", "my-day", "notebook", "echo"]);
let database: DatabaseSync | undefined;

function db() {
  if (database) return database;
  const directory = process.env.MOSAIC_DATA_DIR;
  if (process.env.MOSAIC_DESKTOP !== "1" || !directory) throw new Error("Desktop local storage is unavailable.");
  mkdirSync(directory, { recursive: true });
  database = new DatabaseSync(path.join(directory, "mosaic.sqlite"));
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS local_records (
      id TEXT NOT NULL,
      feature TEXT NOT NULL CHECK (feature IN ('it-projects','meetings','tasks','my-day','notebook','echo')),
      title TEXT NOT NULL,
      data_json TEXT NOT NULL CHECK (json_valid(data_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      clickup_id TEXT,
      clickup_list_id TEXT,
      published_at TEXT,
      PRIMARY KEY (feature, id)
    );
    CREATE INDEX IF NOT EXISTS local_records_by_feature ON local_records(feature, updated_at DESC);
    CREATE TABLE IF NOT EXISTS local_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL CHECK (json_valid(value_json)),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS echo_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS echo_messages_by_conversation ON echo_messages(conversation_id, created_at);
  `);
  return database;
}

function parseRecord<T>(row: Record<string, unknown>): LocalRecord<T> {
  return {
    id: String(row.id),
    feature: row.feature as LocalFeature,
    title: String(row.title),
    data: JSON.parse(String(row.data_json)) as T,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    clickUpId: row.clickup_id == null ? null : String(row.clickup_id),
    clickUpListId: row.clickup_list_id == null ? null : String(row.clickup_list_id),
    publishedAt: row.published_at == null ? null : String(row.published_at),
  };
}

export function isLocalFeature(value: unknown): value is LocalFeature {
  return typeof value === "string" && FEATURES.has(value as LocalFeature);
}

export function listLocalRecords<T>(feature: LocalFeature): LocalRecord<T>[] {
  return db().prepare("SELECT * FROM local_records WHERE feature = ? ORDER BY updated_at DESC").all(feature).map((row) => parseRecord<T>(row as Record<string, unknown>));
}

export function getLocalRecord<T>(feature: LocalFeature, id: string): LocalRecord<T> | null {
  const row = db().prepare("SELECT * FROM local_records WHERE feature = ? AND id = ?").get(feature, id);
  return row ? parseRecord<T>(row as Record<string, unknown>) : null;
}

export function saveLocalRecord<T extends Record<string, unknown>>(feature: LocalFeature, input: { id?: string; title: string; data: T; clickUpId?: string | null; clickUpListId?: string | null }): LocalRecord<T> {
  const title = input.title.trim();
  if (!title || title.length > 500) throw new Error("Record title must contain 1 to 500 characters.");
  if (!input.data || typeof input.data !== "object" || Array.isArray(input.data)) throw new Error("Record data must be an object.");
  const id = input.id?.trim() || randomUUID();
  const now = new Date().toISOString();
  db().prepare(`
    INSERT INTO local_records (id, feature, title, data_json, created_at, updated_at, clickup_id, clickup_list_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(feature, id) DO UPDATE SET
      title = excluded.title, data_json = excluded.data_json, updated_at = excluded.updated_at,
      clickup_id = COALESCE(excluded.clickup_id, local_records.clickup_id),
      clickup_list_id = COALESCE(excluded.clickup_list_id, local_records.clickup_list_id)
  `).run(id, feature, title, JSON.stringify(input.data), now, now, input.clickUpId || null, input.clickUpListId || null);
  return getLocalRecord<T>(feature, id)!;
}

export function deleteLocalRecord(feature: LocalFeature, id: string) {
  return Number(db().prepare("DELETE FROM local_records WHERE feature = ? AND id = ?").run(feature, id).changes) > 0;
}

export function getLocalSetting<T>(key: string, fallback: T): T {
  const row = db().prepare("SELECT value_json FROM local_settings WHERE key = ?").get(key) as { value_json?: string } | undefined;
  return row?.value_json ? JSON.parse(row.value_json) as T : fallback;
}

export function setLocalSetting<T>(key: string, value: T) {
  db().prepare("INSERT INTO local_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at")
    .run(key, JSON.stringify(value), new Date().toISOString());
}

export function deleteLocalSetting(key: string) {
  return Number(db().prepare("DELETE FROM local_settings WHERE key = ?").run(key).changes) > 0;
}

export function saveEchoConversation(messages: Array<{ role: "user" | "assistant"; content: string; timestamp?: string; response?: unknown }>) {
  const connection = db();
  const conversationId = "main";
  connection.exec("BEGIN IMMEDIATE");
  try {
    connection.prepare("DELETE FROM echo_messages WHERE conversation_id = ?").run(conversationId);
    const insert = connection.prepare("INSERT INTO echo_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)");
    for (const message of messages.slice(-500)) {
      const timestamp = message.timestamp && Number.isFinite(Date.parse(message.timestamp)) ? new Date(message.timestamp) : new Date();
      insert.run(randomUUID(), conversationId, message.role, JSON.stringify(message), timestamp.toISOString());
    }
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

export function getEchoConversation() {
  return db().prepare("SELECT content FROM echo_messages WHERE conversation_id = ? ORDER BY created_at").all("main")
    .flatMap((row) => {
      try { return [JSON.parse(String((row as { content: string }).content)) as Record<string, unknown>]; }
      catch { return []; }
    });
}

export function clearEchoConversation() {
  return Number(db().prepare("DELETE FROM echo_messages WHERE conversation_id = ?").run("main").changes) > 0;
}

export function closeLocalDatabase() {
  database?.close();
  database = undefined;
}
