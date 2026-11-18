const fs = require("node:fs");
const path = require("node:path");

const WORKSPACE_ID = "primary";
const PAGE_FOLDERS = ["IT Projects", "Meetings", "Notebook", "Notetaker"];

function readRecords(root) {
  const records = [];
  for (const page of PAGE_FOLDERS) {
    const folder = path.join(root, page);
    if (!fs.existsSync(folder)) continue;
    for (const name of fs.readdirSync(folder)) {
      const filePath = path.join(folder, name);
      if (!name.toLowerCase().endsWith(".json") || !fs.statSync(filePath).isFile()) continue;
      const record = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!record || typeof record !== "object" || typeof record.id !== "string" || typeof record.title !== "string" || !record.data || typeof record.data !== "object") {
        throw new Error(`Cannot sync invalid JSON record: ${path.join(page, name)}`);
      }
      records.push({ page, name, filePath, record });
    }
  }
  return records;
}

function readTombstones(root) {
  const filePath = path.join(root, ".sync", "tombstones.json");
  if (!fs.existsSync(filePath)) return [];
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(data)) throw new Error("Mosaic sync deletion list is invalid.");
  return data.filter((item) => item && typeof item.page === "string" && typeof item.id === "string");
}

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "w" });
  fs.renameSync(temporary, filePath);
}

async function request(url, key, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase sync failed (${response.status}): ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

function tableUrl(url, query = "") {
  return `${url.replace(/\/$/, "")}/rest/v1/mosaic_workspace_records${query}`;
}

function rowKey(page, id) {
  return `${page}\u0000${id}`;
}

async function syncWorkspace({ root, url, key }) {
  if (!url || !key) throw new Error("Configure a Supabase project URL and secret key in Settings first.");
  const local = readRecords(root);
  const tombstones = readTombstones(root);
  const remoteRows = await request(tableUrl(url, `?select=page,record_id,file_name,record,updated_at,deleted_at&workspace_id=eq.${encodeURIComponent(WORKSPACE_ID)}&limit=10000`), key) || [];
  const remote = new Map(remoteRows.map((row) => [rowKey(row.page, row.record_id), row]));
  const localKeys = new Set(local.map(({ page, record }) => rowKey(page, record.id)));
  const tombstoneKeys = new Set(tombstones.map((item) => rowKey(item.page, item.id)));
  let uploaded = 0;
  let downloaded = 0;
  let deleted = 0;

  for (const { page, name, record } of local) {
    const row = {
      workspace_id: WORKSPACE_ID,
      page,
      record_id: record.id,
      file_name: name,
      record,
      updated_at: record.updatedAt || new Date().toISOString(),
      deleted_at: null,
    };
    await request(tableUrl(url, "?on_conflict=workspace_id,page,record_id"), key, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(row),
    });
    uploaded += 1;
  }

  for (const item of tombstones) {
    const row = {
      workspace_id: WORKSPACE_ID,
      page: item.page,
      record_id: item.id,
      file_name: "",
      record: null,
      updated_at: item.deletedAt || new Date().toISOString(),
      deleted_at: item.deletedAt || new Date().toISOString(),
    };
    await request(tableUrl(url, "?on_conflict=workspace_id,page,record_id"), key, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(row),
    });
    deleted += 1;
  }

  for (const row of remoteRows) {
    const keyValue = rowKey(row.page, row.record_id);
    if (localKeys.has(keyValue) || tombstoneKeys.has(keyValue) || row.deleted_at || !row.record) continue;
    const page = String(row.page);
    const name = path.basename(String(row.file_name || ""));
    if (!PAGE_FOLDERS.includes(page) || !name.toLowerCase().endsWith(".json")) continue;
    const filePath = path.join(root, page, name);
    if (fs.existsSync(filePath)) continue;
    atomicWrite(filePath, `${JSON.stringify(row.record, null, 2)}\n`);
    downloaded += 1;
  }

  return { uploaded, downloaded, deleted, syncedAt: new Date().toISOString() };
}

module.exports = { syncWorkspace };
