"use client";

import React from "react";
import { Mic } from "lucide-react";

interface StudioPillProps {
  /** Elapsed recording time in seconds. */
  elapsedSeconds: number;
  isPaused?: boolean;
  /** Callback to restore the studio panel from minimized state. */
  onRestore: () => void;
}

/** Formats elapsed recording time as HH:MM:SS. */
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Compact recording indicator pill shown in the topbar when the studio
 * is minimized. Clicking restores the studio panel.
 */
export function StudioPill({ elapsedSeconds, isPaused = false, onRestore }: StudioPillProps) {
  return (
    <button
      type="button"
      onClick={onRestore}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${isPaused ? "bg-warning-surface border border-warning-border text-warning-fg hover:bg-warning-surface" : "bg-danger-surface border border-danger-border text-danger-fg hover:bg-danger-surface"}`}
      title="Restore Recording Studio"
      aria-label={`Recording in progress: ${formatTime(elapsedSeconds)}. Click to restore studio.`}
    >
      <span className="relative flex h-2 w-2">
        {!isPaused && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger-fg opacity-75" />}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${isPaused ? "bg-warning-fg" : "bg-danger-fg"}`} />
      </span>
      <Mic size={12} />
      <span>{isPaused ? "Paused" : "Recording"} · {formatTime(elapsedSeconds)}</span>
    </button>
  );
}
