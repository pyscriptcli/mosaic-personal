"use client";

/**
 * Studio Storage Layer — IndexedDB persistence for crash-resilient recording.
 *
 * Database: echo_studio_db
 * Stores:
 *   - recording_chunks: Raw audio Blob chunks keyed by {sessionId}_{chunkIndex}
 *   - recording_sessions: Session metadata (start time, notes, elapsed, status)
 */

import type { StudioNote, StudioSession } from "@/features/notetaker/types/studio";

const DB_NAME = "echo_studio_db";
const DB_VERSION = 1;
const CHUNKS_STORE = "recording_chunks";
const SESSIONS_STORE = "recording_sessions";

interface ChunkRecord {
  id: string;
  sessionId: string;
  index: number;
  blob: Blob;
}

// ─────────────────────────────────────────────────────────────────────────────
// Database Connection (lazy singleton)
// ─────────────────────────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

/** Opens or returns the singleton IndexedDB connection. */
export function openStudioDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        const chunkStore = db.createObjectStore(CHUNKS_STORE, { keyPath: "id" });
        chunkStore.createIndex("sessionId", "sessionId", { unique: false });
      }
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: "sessionId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chunk Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Saves a raw audio chunk to IndexedDB.
 * Called every ~10 seconds during active recording for crash resilience.
 */
export async function saveChunk(sessionId: string, index: number, blob: Blob): Promise<void> {
  const db = await openStudioDb();
  const id = `${sessionId}_chunk_${index}`;
  const record: ChunkRecord = { id, sessionId, index, blob };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHUNKS_STORE, "readwrite");
    tx.objectStore(CHUNKS_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieves all chunks for a session, sorted by index.
 */
async function getChunks(sessionId: string): Promise<ChunkRecord[]> {
  const db = await openStudioDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHUNKS_STORE, "readonly");
    const index = tx.objectStore(CHUNKS_STORE).index("sessionId");
    const request = index.getAll(sessionId);
    request.onsuccess = () => {
      const chunks = (request.result as ChunkRecord[]).sort((a, b) => a.index - b.index);
      resolve(chunks);
    };
    request.onerror = () => reject(request.error);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Operations
// ─────────────────────────────────────────────────────────────────────────────

/** Creates or updates session metadata in IndexedDB. */
export async function saveSessionMeta(session: StudioSession): Promise<void> {
  const db = await openStudioDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, "readwrite");
    tx.objectStore(SESSIONS_STORE).put(session);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Retrieves session metadata by sessionId. */
export async function getSessionMeta(sessionId: string): Promise<StudioSession | null> {
  const db = await openStudioDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, "readonly");
    const request = tx.objectStore(SESSIONS_STORE).get(sessionId);
    request.onsuccess = () => resolve((request.result as StudioSession) || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Finds sessions that were left in 'active' status — these are interrupted
 * recordings from a crash or unexpected tab close.
 *
 * Excludes:
 *  - The currently active recording session (if provided)
 *  - Sessions actively heartbeating within the last 15 seconds (ongoing in another tab or currently recording)
 *  - Sessions explicitly marked completed
 */
export async function getInterruptedSessions(excludeSessionId?: string | null): Promise<StudioSession[]> {
  const db = await openStudioDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, "readonly");
    const request = tx.objectStore(SESSIONS_STORE).getAll();
    request.onsuccess = () => {
      const all = request.result as StudioSession[];
      const now = Date.now();
      const filtered = all.filter((s) => {
        // Exclude explicitly completed sessions
        if (s.status === "completed") return false;
        // Exclude currently active session id
        if (excludeSessionId && s.sessionId === excludeSessionId) return false;
        // If status is active, check heartbeat freshness to ensure it's not currently ongoing
        if (s.status === "active") {
          if (s.lastHeartbeat) {
            const lastBeat = new Date(s.lastHeartbeat).getTime();
            // If the session had a heartbeat within the last 15 seconds, it's ongoing, not interrupted
            if (now - lastBeat < 15_000) {
              return false;
            }
          }
          return true;
        }
        return s.status === "interrupted";
      });
      resolve(filtered);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Assembles all chunks for a session into a single audio Blob.
 * The chunks are assumed to be raw MediaRecorder output (WebM/Ogg containers).
 */
export async function assembleRecording(sessionId: string): Promise<Blob> {
  const chunks = await getChunks(sessionId);
  if (chunks.length === 0) {
    throw new Error(`No audio chunks found for session ${sessionId}`);
  }

  // Use the MIME type from the first chunk, fall back to audio/webm
  const mimeType = chunks[0].blob.type || "audio/webm";
  return new Blob(
    chunks.map((c) => c.blob),
    { type: mimeType }
  );
}

/**
 * Assembles and returns a File object ready for download or Notetaker handoff.
 */
export async function exportSessionAsFile(sessionId: string): Promise<File> {
  const blob = await assembleRecording(sessionId);
  const session = await getSessionMeta(sessionId);
  const isVideo = session?.mediaType === "video" || blob.type.startsWith("video/");
  const ext = "webm";
  const prefix = isVideo ? "echo-video" : "echo-recording";
  return new File([blob], `${prefix}-${sessionId}.${ext}`, { type: blob.type || (isVideo ? "video/webm" : "audio/webm") });
}

/**
 * Deletes all chunks and metadata for a session.
 * Called after successful handoff to Notetaker or manual discard.
 */
export async function clearSession(sessionId: string): Promise<void> {
  const db = await openStudioDb();

  // Delete all chunks for this session
  const chunks = await getChunks(sessionId);
  const chunkTx = db.transaction(CHUNKS_STORE, "readwrite");
  const chunkStore = chunkTx.objectStore(CHUNKS_STORE);
  for (const chunk of chunks) {
    chunkStore.delete(chunk.id);
  }
  await new Promise<void>((resolve, reject) => {
    chunkTx.oncomplete = () => resolve();
    chunkTx.onerror = () => reject(chunkTx.error);
  });

  // Delete session metadata
  const sessionTx = db.transaction(SESSIONS_STORE, "readwrite");
  sessionTx.objectStore(SESSIONS_STORE).delete(sessionId);
  await new Promise<void>((resolve, reject) => {
    sessionTx.oncomplete = () => resolve();
    sessionTx.onerror = () => reject(sessionTx.error);
  });
}

/**
 * Triggers a browser download for a session's recording.
 * Used for auto-download on interruption and manual recovery.
 */
export async function downloadSession(sessionId: string): Promise<void> {
  const rawFile = await exportSessionAsFile(sessionId);
  const session = await getSessionMeta(sessionId);
  const saved = await saveToLocalDocuments(sessionId, rawFile, "completed", session?.mediaType || (rawFile.type.startsWith("video/") ? "video" : "audio"), rawFile.name, session?.notes, true);
  if (!saved.success || !saved.file) throw new Error("Recording conversion did not finish; the recoverable source remains available in Archives.");
  const file = saved.file;
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();

  // Cleanup after a short delay to ensure download starts
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 1000);
}

/**
 * Saves a recording blob in Mosaic's local recording storage via its local API.
 * Supports "completed", "checkpoint", and "interrupted" saves.
 */
export async function saveToLocalDocuments(
  sessionId: string,
  blob: Blob,
  status: "completed" | "interrupted" | "checkpoint" = "completed",
  mediaType: "audio" | "video" = "audio",
  customFileName?: string,
  notes?: StudioNote[],
  includeConvertedFile = true
): Promise<{ success: boolean; filePath?: string; fileName?: string; file?: File }> {
  try {
    const formData = new FormData();
    const ext = "webm";
    const file = new File([blob], customFileName || `${sessionId}.${ext}`, { type: blob.type || "audio/webm" });
    formData.append("file", file);
    formData.append("sessionId", sessionId);
    formData.append("status", status);
    formData.append("mediaType", mediaType);
    if (customFileName) formData.append("fileName", customFileName);
    if (notes) formData.append("notes", JSON.stringify(notes));

    const res = await fetch("/api/recordings/save-local", {
      method: "POST",
      body: formData,
    });
    if (res.ok) {
      const data = await res.json();
      if (data.conversionJobId) {
        while (true) {
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
          const statusRes = await fetch(`/api/recordings/conversion?jobId=${encodeURIComponent(data.conversionJobId)}`);
          if (!statusRes.ok) return { success: false };
          const { job } = await statusRes.json() as { job: { state: string; error?: string; outputPath: string } };
          if (job.state === "failed") throw new Error(job.error || "Recording conversion failed.");
          if (job.state !== "ready") continue;
          if (!includeConvertedFile) return { success: true, filePath: job.outputPath, fileName: job.outputPath.split(/[\\/]/).pop() };
          const convertedRes = await fetch(`/api/recordings/download?fileName=${encodeURIComponent(job.outputPath.split(/[\\/]/).pop() || "")}`);
          if (!convertedRes.ok) return { success: false };
          const convertedBlob = await convertedRes.blob();
          const fileName = job.outputPath.split(/[\\/]/).pop() || "recording";
          return { success: true, filePath: job.outputPath, fileName, file: new File([convertedBlob], fileName, { type: convertedBlob.type }) };
        }
      }
      return { success: true, filePath: data.filePath, fileName: data.fileName };
    }
    return { success: false };
  } catch (err) {
    console.warn("[StudioStorage] Failed to auto-save to local Documents:", err);
    return { success: false };
  }
}

/**
 * Requests browser persistent storage quota so IndexedDB data is never evicted.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.persist) {
    try {
      const isPersisted = await navigator.storage.persisted();
      if (!isPersisted) {
        return await navigator.storage.persist();
      }
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

