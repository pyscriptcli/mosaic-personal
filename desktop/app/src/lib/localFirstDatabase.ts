import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deleteLocalRecord, getLocalRecord, isLocalFeature, listLocalRecords, removeLocalRecordDataFields, saveLocalRecord, type LocalFeature, type LocalRecord } from "@/lib/localJsonStore";

let database: DatabaseSync | undefined;

export { deleteLocalRecord, getLocalRecord, isLocalFeature, listLocalRecords, saveLocalRecord };
export type { LocalFeature, LocalRecord };

function db() {
  if (database) return database;
  const directory = process.env.MOSAIC_INTERNAL_DATA_DIR;
  if (process.env.MOSAIC_DESKTOP !== "1" || !directory) throw new Error("Desktop local storage is unavailable.");
  mkdirSync(directory, { recursive: true });
  database = new DatabaseSync(path.join(directory, "mosaic-internal.sqlite"));
  database.exec(`
    PRAGMA journal_mode = WAL;
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

export function removeLocalNotebookCategories() {
  const key = "migration.notebook-categories-removed.v1";
  if (getLocalSetting(key, false)) return;
  for (const record of listLocalRecords("notebook")) {
    removeLocalRecordDataFields("notebook", record.id, ["categories"]);
  }
  setLocalSetting(key, true);
}

export function closeLocalDatabase() {
  database?.close();
  database = undefined;
}
