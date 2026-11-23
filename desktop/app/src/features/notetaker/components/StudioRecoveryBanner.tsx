"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, Download, X, Sparkles, Folder } from "lucide-react";
import type { StudioSession } from "@/features/notetaker/types/studio";
import { getInterruptedSessions, downloadSession, clearSession, exportSessionAsFile, saveToLocalDocuments } from "@/features/notetaker/lib/studioStorage";

interface StudioRecoveryBannerProps {
  onProcessSession?: (file: File) => void;
  /** Session ID of an actively running recording session to exclude. */
  activeSessionId?: string | null;
  /** True when recording is actively ongoing. */
  isRecording?: boolean;
}

/**
 * Banner shown at the top of the page when an interrupted recording session
 * is found in IndexedDB or local recording storage (e.g., after a browser crash or battery cut).
 * Offers 1-click Notetaker processing, download, or discard.
 */
export function StudioRecoveryBanner({
  onProcessSession,
  activeSessionId,
  isRecording = false,
}: StudioRecoveryBannerProps) {
  const [sessions, setSessions] = useState<StudioSession[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);

  const loadSessions = () => {
    getInterruptedSessions(activeSessionId)
      .then((records) => {
        // Double filter out active session or if actively recording
        const filtered = records.filter((s) => {
          if (activeSessionId && s.sessionId === activeSessionId) return false;
          return true;
        });
        setSessions(filtered);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadSessions();
    const handleCheckInterrupted = () => loadSessions();
    window.addEventListener("focus", handleCheckInterrupted);
    return () => window.removeEventListener("focus", handleCheckInterrupted);
  }, [activeSessionId, isRecording]);

  // If the user is actively recording in this tab, do not distract them with an interrupted banner
  // for the current ongoing session
  const visibleSessions = sessions.filter((s) => !activeSessionId || s.sessionId !== activeSessionId);

  if (visibleSessions.length === 0) return null;

  const handleProcess = async (sessionId: string) => {
    setProcessing(sessionId);
    try {
      const rawFile = await exportSessionAsFile(sessionId);
      const session = sessions.find((item) => item.sessionId === sessionId);
      const saved = await saveToLocalDocuments(sessionId, rawFile, "completed", session?.mediaType || "audio", rawFile.name, session?.notes, true);
      if (!saved.success || !saved.file) throw new Error("Recording conversion did not finish.");
      await clearSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
      onProcessSession?.(saved.file);
    } catch (err) {
      console.error("[Studio Recovery] Processing failed:", err);
    } finally {
      setProcessing(null);
    }
  };

  const handleDownload = async (sessionId: string) => {
    setDownloading(sessionId);
    try {
      await downloadSession(sessionId);
      await clearSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
    } catch (err) {
      console.error("[Studio Recovery] Download failed:", err);
    } finally {
      setDownloading(null);
    }
  };

  const handleDiscard = async (sessionId: string) => {
    try {
      await clearSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
    } catch (err) {
      console.error("[Studio Recovery] Discard failed:", err);
    }
  };

  /** Format elapsed recording time as HH:MM:SS. */
  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    const remainder = seconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  };

  /** Format ISO date into short display. */
  const formatDate = (iso: string): string => {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  return (
    <aside aria-label="Interrupted recording recovery notifications" className="space-y-0">
      {visibleSessions.map((session) => (
        <div
          key={session.sessionId}
          className="bg-warning-surface border-b border-warning-border px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-xs"
        >
          <div className="flex items-center gap-2 text-warning-fg text-xs font-medium min-w-0">
            <AlertTriangle size={15} className="shrink-0 text-warning-fg" />
            <div className="truncate">
              <span className="font-bold">Interrupted recording recovered</span>
              {session.elapsedSeconds > 0 && ` (${formatDuration(session.elapsedSeconds)}`}
              {session.startedAt && ` from ${formatDate(session.startedAt)}`}
              {session.elapsedSeconds > 0 && ")"}
              <span className="ml-2 text-[10px] text-warning-fg bg-warning-surface px-1.5 py-0.5 border border-warning-border inline-flex items-center gap-1">
                <Folder size={10} /> Auto-saved locally
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onProcessSession && (
              <button
                type="button"
                onClick={() => handleProcess(session.sessionId)}
                disabled={processing === session.sessionId}
                className="inline-flex items-center gap-1 text-xs font-bold bg-action text-on-action px-2.5 py-1 hover:bg-action-hover transition-colors  cursor-pointer shadow-2xs"
              >
                <Sparkles size={11} className="text-link" />
                {processing === session.sessionId ? "Loading…" : "Process into Minutes Now"}
              </button>
            )}
            <button
              type="button"
              onClick={() => handleDownload(session.sessionId)}
              disabled={downloading === session.sessionId}
              className="inline-flex items-center gap-1 text-xs font-bold text-fg hover:underline  px-1.5 py-0.5"
            >
              <Download size={12} />
              {downloading === session.sessionId ? "Downloading…" : "Download"}
            </button>
            <span className="text-warning-fg">·</span>
            <button
              type="button"
              onClick={() => handleDiscard(session.sessionId)}
              className="inline-flex items-center gap-1 text-xs font-bold text-fg-muted hover:text-danger-fg px-1.5 py-0.5 cursor-pointer"
            >
              <X size={12} />
              Discard
            </button>
          </div>
        </div>
      ))}
    </aside>
  );
}
