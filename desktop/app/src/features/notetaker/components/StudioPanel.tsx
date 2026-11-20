"use client";

import React, { useCallback, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Download,
  FolderOpen,
  MessageCircle,
  Mic,
  Pause,
  Pencil,
  Play,
  Plus,
  Send,
  Square,
  Sparkles,
  Trash2,
  Video,
  X,
  Monitor,
  AlertTriangle,
} from "lucide-react";
import type { StudioNote, StudioDisplayMode } from "@/features/notetaker/types/studio";
import type { UseStudioRecorderReturn } from "@/hooks/useStudioRecorder";
import { useLiveTranscription } from "@/hooks/useLiveTranscription";
import { useAudioVisualizer } from "@/hooks/useAudioVisualizer";
import { clearSession } from "@/features/notetaker/lib/studioStorage";
import { EchoAI } from "@/features/ask-echo/components/EchoAI";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface StudioPanelProps {
  isOpen: boolean;
  /** Render inside the notetaker workspace instead of as a fixed overlay. */
  embedded?: boolean;
  /** Meeting metadata owned by the Notetaker, rendered below recording status. */
  meetingDetails?: React.ReactNode;
  mode: StudioDisplayMode;
  onChangeMode: (mode: StudioDisplayMode) => void;
  onClose: () => void;
  onSendToNotetaker: (file: File, notes: StudioNote[], preparedTranscript?: string) => void;
  onOpenSource?: (page: string, recordId: string, url?: string) => void;
  onRecordingStart?: (startTime: string) => void;
  onRecordingStop?: (endTime: string) => void;
  askEchoEnabled?: boolean;
  allowedFeatures?: string[];
  recorder: UseStudioRecorderReturn;
}

type DisplayCaptureSource = { id: string; name: string; thumbnail: string; appIcon: string | null };
type DisplayCaptureRequest = { requestId: string; sources: DisplayCaptureSource[] };
type MosaicDesktopBridge = {
  onDisplayCaptureRequest: (listener: (request: DisplayCaptureRequest) => void) => () => void;
  selectDisplayCaptureSource: (requestId: string, sourceId: string | null) => Promise<boolean>;
  openRecordingLocation: (fileName: string) => Promise<boolean>;
};


// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Volume Meter
// ─────────────────────────────────────────────────────────────────────────────

function VolumeMeter({ level, isClipping }: { level: number; isClipping: boolean }) {
  return (
    <div className="h-9 flex items-center gap-1" title={`Microphone level: ${level}%`} aria-label={`Microphone level ${level}%`}>
      {Array.from({ length: 24 }, (_, index) => {
        const active = level >= (index + 1) * (100 / 24);
        const height = 8 + ((index * 7) % 20);
        return <span key={index} className={`w-1 transition-all duration-75 ${active ? (isClipping ? "bg-red-500" : "bg-[#003366]") : "bg-slate-200"}`} style={{ height }} />;
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recording Studio side panel with three display modes (panel, fullscreen, minimized).
 * Uses elevated useStudioRecorder for crash-resilient recording and useAudioVisualizer
 * for live mic feedback.
 */
export function StudioPanel({
  isOpen,
  embedded = false,
  meetingDetails,
  mode,
  onChangeMode,
  onClose,
  onSendToNotetaker,
  onOpenSource,
  onRecordingStart,
  onRecordingStop,
  askEchoEnabled = true,
  allowedFeatures,
  recorder,
}: StudioPanelProps) {
  const liveTranscript = useLiveTranscription(recorder.audioStream);
  const visualizer = useAudioVisualizer(recorder.audioStream);

  // ── Notes State ────────────────────────────────────────────────────────
  const [notes, setNotes] = useState<StudioNote[]>([]);
  const [noteInput, setNoteInput] = useState("");
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [meetingLink, setMeetingLink] = useState("");
  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingType, setMeetingType] = useState("Internal");
  const [botStatus, setBotStatus] = useState("");
  const [botId, setBotId] = useState<string | null>(null);
  const [isSendingBot, setIsSendingBot] = useState(false);
  const [captureMode, setCaptureMode] = useState<"meeting_link" | "device">("device");
  const [workspaceTab, setWorkspaceTab] = useState<"notes" | "echo" | "transcript">("echo");
  const [mobilePanel, setMobilePanel] = useState<"capture" | "notes" | "assistant">("notes");
  const canAskEcho = askEchoEnabled && (!allowedFeatures || allowedFeatures.includes("ask-echo"));
  const canRecord = !allowedFeatures || allowedFeatures.includes("notetaker-record");
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [displayCaptureRequest, setDisplayCaptureRequest] = useState<DisplayCaptureRequest | null>(null);
  const [selectedDisplaySourceId, setSelectedDisplaySourceId] = useState<string | null>(null);
  const [displayCaptureError, setDisplayCaptureError] = useState("");
  const [isOpeningRecordingLocation, setIsOpeningRecordingLocation] = useState(false);
  const [recordingLocationError, setRecordingLocationError] = useState("");
  const notesEndRef = useRef<HTMLDivElement>(null);
  const isVideoRecording = recorder.recordedFile?.type.startsWith("video/") || recorder.mediaType === "video";

  React.useEffect(() => {
    const bridge = (window as Window & { mosaicDesktop?: MosaicDesktopBridge }).mosaicDesktop;
    return bridge?.onDisplayCaptureRequest((request) => {
      setDisplayCaptureRequest(request);
      setSelectedDisplaySourceId(null);
      setDisplayCaptureError("");
    });
  }, []);

  const respondToDisplayCapture = useCallback(async (sourceId: string | null) => {
    if (!displayCaptureRequest) return;
    setSelectedDisplaySourceId(sourceId);
    try {
      const bridge = (window as Window & { mosaicDesktop?: MosaicDesktopBridge }).mosaicDesktop;
      const accepted = await bridge?.selectDisplayCaptureSource(displayCaptureRequest.requestId, sourceId);
      if (accepted) setDisplayCaptureRequest(null);
      else setDisplayCaptureError("Mosaic could not use that source. Choose again.");
    } catch {
      setDisplayCaptureError("Mosaic could not use that source. Choose again.");
    } finally {
      setSelectedDisplaySourceId(null);
    }
  }, [displayCaptureRequest]);

  React.useEffect(() => {
    if (!displayCaptureRequest) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void respondToDisplayCapture(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [displayCaptureRequest, respondToDisplayCapture]);

  // The top-bar New Meeting action starts the same botless recorder session.
  React.useEffect(() => {
    const startMeeting = () => { if (recorder.status === "idle") void recorder.start(); };
    window.addEventListener("echo-start-meeting", startMeeting);
    return () => window.removeEventListener("echo-start-meeting", startMeeting);
  }, [recorder.status]);

  const prevRecorderStatusRef = useRef(recorder.status);
  React.useEffect(() => {
    const prev = prevRecorderStatusRef.current;
    if (prev === "idle" && recorder.status === "recording") {
      const now = new Date().toTimeString().slice(0, 5);
      onRecordingStart?.(now);
    }
    if ((prev === "recording" || prev === "paused") && recorder.status === "stopped") {
      const now = new Date().toTimeString().slice(0, 5);
      onRecordingStop?.(now);
    }
    prevRecorderStatusRef.current = recorder.status;
  }, [recorder.status, onRecordingStart, onRecordingStop]);

  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const startEditingNote = useCallback((note: StudioNote) => {
    setEditingNoteId(note.id);
    setEditingText(note.text);
  }, []);

  const saveEditingNote = useCallback(() => {
    if (!editingNoteId) return;
    const trimmed = editingText.trim();
    if (!trimmed) {
      setEditingNoteId(null);
      setEditingText("");
      return;
    }
    setNotes((prev) =>
      prev.map((n) => (n.id === editingNoteId ? { ...n, text: trimmed } : n))
    );
    setEditingNoteId(null);
    setEditingText("");
  }, [editingNoteId, editingText]);

  const cancelEditingNote = useCallback(() => {
    setEditingNoteId(null);
    setEditingText("");
  }, []);

  const addNote = useCallback(() => {
    const text = noteInput.trim();
    if (!text) return;
    const timestamp = (recorder.status === "recording" || recorder.status === "paused")
      ? `[${formatTime(recorder.elapsedSeconds)}]`
      : "[00:00]";
    const note: StudioNote = {
      id: `note_${Date.now()}`,
      timestamp,
      text,
    };
    setNotes((prev) => [...prev, note]);
    setNoteInput("");
    setTimeout(() => notesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, [noteInput, recorder.status, recorder.elapsedSeconds]);

  const removeNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (editingNoteId === id) {
      setEditingNoteId(null);
      setEditingText("");
    }
  }, [editingNoteId]);

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleClose = () => {
    if (recorder.status === "recording" || recorder.status === "paused") {
      setShowCloseConfirm(true);
      return;
    }
    onClose();
  };

  const handleSendToNotetaker = async () => {
    if (recorder.recordedFile && !isFinalizing) {
      setIsFinalizing(true);
      const preparedTranscript = await liveTranscript.finalize();
      onSendToNotetaker(recorder.recordedFile, notes, preparedTranscript || undefined);
      // Clean up IndexedDB session after successful handoff
      if (recorder.sessionId) {
        clearSession(recorder.sessionId).catch(() => {});
      }
      setNotes([]);
      setNoteInput("");
      liveTranscript.reset();
      recorder.reset();
      setIsFinalizing(false);
    }
  };

  const handleDiscard = () => {
    if (recorder.sessionId) {
      clearSession(recorder.sessionId).catch(() => {});
    }
    setNotes([]);
    setNoteInput("");
    liveTranscript.reset();
    recorder.reset();
  };

  const handleSaveRecording = () => {
    if (!recorder.recordedFile) return;
    const url = URL.createObjectURL(recorder.recordedFile);
    const link = document.createElement("a");
    link.href = url;
    link.download = recorder.recordedFile.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleOpenRecordingLocation = async () => {
    const fileName = recorder.localSavedPath?.split(/[/\\]/).pop();
    if (!fileName) return;
    setIsOpeningRecordingLocation(true);
    setRecordingLocationError("");
    try {
      const bridge = (window as Window & { mosaicDesktop?: MosaicDesktopBridge }).mosaicDesktop;
      const opened = await bridge?.openRecordingLocation(fileName);
      if (!opened) setRecordingLocationError("Recording file could not be found.");
    } catch {
      setRecordingLocationError("Recording folder could not be opened.");
    } finally {
      setIsOpeningRecordingLocation(false);
    }
  };

  const sendEchoBot = async () => {
    if (!meetingLink.trim() || isSendingBot) return;
    setIsSendingBot(true);
    setBotStatus("");
    try {
      const response = await fetch("/api/meetstream/bots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ meetingLink }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Mosaic Notetaker could not join this meeting.");
      setBotId(data.botId || null);
      setBotStatus("Mosaic is joining the meeting… admit Mosaic Notetaker if the meeting asks for approval.");
      setMeetingLink("");
    } catch (error) {
      setBotStatus(error instanceof Error ? error.message : "Mosaic Notetaker could not join this meeting.");
    } finally {
      setIsSendingBot(false);
    }
  };

  React.useEffect(() => {
    if (!botId) return;
    let cancelled = false;
    const terminalStatuses = new Set(["Done", "Completed", "Stopped", "Denied", "NotAllowed", "Error", "Failed", "Kicked"]);
    const readStatus = async () => {
      try {
        const response = await fetch(`/api/meetstream/bots/${encodeURIComponent(botId)}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to read Mosaic meeting status.");
        if (cancelled) return;
        const status = String(data.status || "Unknown");
        const messages: Record<string, string> = {
          Joining: "Mosaic is joining the meeting…",
          InWaitingRoom: "Mosaic is waiting for admission to the meeting.",
          InMeeting: "Mosaic is in the meeting and catching up.",
          Recording: "Mosaic is recording the meeting.",
          Leaving: "Mosaic is leaving the meeting and preparing the recording.",
          MediaProcessing: "Mosaic is processing the meeting audio.",
          Transcribing: "Mosaic is transcribing the meeting.",
          Done: "Mosaic finished processing the meeting.",
          Completed: "Mosaic finished processing the meeting.",
          Denied: "Mosaic was not admitted to the meeting.",
          NotAllowed: "Mosaic was not allowed to join the meeting.",
          Failed: "Mosaic could not process the meeting.",
          Error: "Mosaic could not process the meeting.",
        };
        setBotStatus(messages[status] || `Mosaic status: ${status}`);
        if (terminalStatuses.has(status)) setBotId(null);
      } catch (error) {
        if (!cancelled) setBotStatus(error instanceof Error ? error.message : "Unable to read Mosaic meeting status.");
      }
    };
    void readStatus();
    const interval = window.setInterval(() => void readStatus(), 5000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [botId]);

  const isRecordingActive = recorder.status === "recording" || recorder.status === "paused";
  const isStopped = recorder.status === "stopped" && recorder.recordedFile !== null;
  const echoMeetingContext = React.useMemo(() => [
    liveTranscript.segments.length > 0
      ? `Timestamped transcript:\n${liveTranscript.segments.slice(-100).map((segment) => `[${formatTime(segment.startedAtSeconds)}] ${segment.text}`).join("\n")}`
      : "",
    notes.length > 0
      ? `Meeting notes:\n${notes.map((note) => `${note.timestamp} ${note.text}`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n\n"), [liveTranscript.segments, notes]);

  React.useEffect(() => {
    window.dispatchEvent(new CustomEvent("echo-recording-state", { detail: { active: isRecordingActive, paused: recorder.status === "paused", elapsedSeconds: recorder.elapsedSeconds } }));
  }, [isRecordingActive, recorder.status, recorder.elapsedSeconds]);

  // ── Don't render if not open or minimized ──────────────────────────────
  if (!isOpen || mode === "minimized") return null;

  // ── Layout classes based on mode ───────────────────────────────────────
  const isFullscreen = embedded || mode === "fullscreen";
  const panelClasses = isFullscreen
    ? `${embedded ? "w-full h-full flex-1 min-h-0 overflow-hidden" : "fixed inset-0 z-50"} bg-[#F7F9FC] flex flex-col`
    : "fixed right-0 inset-y-0 z-50 w-full max-w-xl bg-[#F7F9FC] border-l border-[#D9E1EA] shadow-2xl flex flex-col";

  return (
    <>
      {/* Backdrop (panel mode only) */}
      {!isFullscreen && !embedded && (
        <button
          aria-label="Close Recording Studio"
          onClick={handleClose}
          className="fixed inset-0 z-40 bg-[#003366]/30 backdrop-blur-[2px]"
        />
      )}

      <section aria-label="Recording Studio" className={`${panelClasses} notetaker-workspace`}>
        {/* ── Content ─────────────────────────────────────────────────── */}
        <div className={`flex-1 min-h-0 overflow-hidden flex flex-col ${isFullscreen ? "lg:grid lg:grid-cols-[minmax(250px,0.84fr)_minmax(0,1.5fr)_minmax(280px,0.9fr)] lg:gap-2 lg:p-2" : ""} bg-[#F3F6FA]`}>

          {isFullscreen && (
            <div className="grid shrink-0 grid-cols-3 border-b border-slate-200 bg-white lg:hidden" role="group" aria-label="Meeting workspace panels">
              {([
                ["capture", "Capture"],
                ["notes", "Notes"],
                ["assistant", canAskEcho ? "Ask Echo" : "Transcript"],
              ] as const).map(([panel, label]) => (
                <button
                  key={panel}
                  type="button"
                  aria-pressed={mobilePanel === panel}
                  onClick={() => setMobilePanel(panel)}
                  className={`border-b-2 px-2 py-2.5 text-xs font-semibold transition-colors ${mobilePanel === panel ? "border-[#0078D4] text-[#003366]" : "border-transparent text-slate-500 hover:text-[#003366]"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* ── Left / Top: Recording Controls ────────────────────────── */}
          <div id="meeting-capture-panel" role={isFullscreen ? "region" : undefined} aria-label={isFullscreen ? "Capture" : undefined} className={`mosaic-flat-card ${isFullscreen ? "w-full min-w-0 lg:border" : "w-full border-b border-[#D9E1EA]"} ${isFullscreen && mobilePanel !== "capture" ? "hidden lg:flex" : "flex"} ${isFullscreen ? "min-h-0 flex-1 lg:h-full lg:flex-none" : "h-full min-h-0"} flex-col bg-white`}>
            {/* Header with live status badge matching Col 2 & 3 */}
            <div className="px-3 py-2 border-b border-slate-200 bg-white shrink-0 flex items-center justify-between min-h-11">
              <div>
                <h3 className="text-sm font-semibold text-[#003366]">Recording</h3>
              </div>
              <div>
                {isRecordingActive ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-red-600 bg-red-50 border border-red-200 px-2.5 py-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
                    {recorder.status === "paused" ? "Paused" : "Live"}
                  </span>
                ) : isStopped ? (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1">
                    Ready
                  </span>
                ) : (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-1">
                    Standby
                  </span>
                )}
              </div>
            </div>

            {/* Scrollable Column 1 Body (scrollbar hidden, scroll enabled) */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-3">

            {/* Idle state: Compact Capture & Recording Controls */}
            {recorder.status === "idle" && (
              <div className="mosaic-flat-card border border-slate-200 bg-white p-2 space-y-2">
                {/* Segmented Mode Switch: Audio Recording vs Video Recording */}
                <div className="grid grid-cols-2 gap-1 bg-slate-100 p-0.5 border border-slate-200">
                  <button
                    type="button"
                    onClick={() => recorder.setMediaType("audio")}
                    className={`py-1 px-2 text-[10px] font-bold uppercase tracking-wider text-center transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      recorder.mediaType === "audio"
                        ? "bg-[#003366] text-white"
                        : "text-slate-600 hover:text-[#003366]"
                    }`}
                  >
                    <Mic size={11} className={recorder.mediaType === "audio" ? "text-[#0078D4]" : ""} />
                    <span>Audio</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => recorder.setMediaType("video")}
                    className={`py-1 px-2 text-[10px] font-bold uppercase tracking-wider text-center transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      recorder.mediaType === "video"
                        ? "bg-[#003366] text-white shadow-2xs"
                        : "text-slate-600 hover:text-[#003366]"
                    }`}
                  >
                    <Video size={11} className={recorder.mediaType === "video" ? "text-[#0078D4]" : ""} />
                    <span>Video</span>
                  </button>
                </div>

                {/* Device Mode Controls */}
                <div className="space-y-2">
                  <p className="text-[10px] text-slate-500">
                    {recorder.mediaType === "video"
                      ? "Records your screen video along with meeting tab/system audio and microphone."
                      : "Records meeting tab/system audio and your microphone (audio-only file)."}
                  </p>

                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Microphone Source
                    </label>
                    <div className="relative">
                      <select
                        value={recorder.selectedDeviceId || ""}
                        onChange={(e) => recorder.selectDevice(e.target.value)}
                        className="w-full border border-slate-200 bg-[#FFFCFB] text-xs text-slate-800 px-2.5 py-1.5 pr-7 appearance-none outline-none focus:border-[#0078D4]"
                      >
                        <option value="">System Default</option>
                        {recorder.availableDevices.map((device) => (
                          <option key={device.deviceId} value={device.deviceId}>
                            {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={!canRecord}
                    onClick={() => void recorder.start()}
                    className="w-full h-8 px-3 bg-[#003366] text-white hover:bg-[#002244] font-medium text-xs flex items-center justify-center gap-2 border border-[#003366] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {recorder.mediaType === "video" ? (
                      <Video size={15} className="text-[#0078D4]" />
                    ) : (
                      <Mic size={15} className="text-[#0078D4]" />
                    )}
                    <span>
                      {canRecord
                        ? recorder.mediaType === "video"
                          ? "Start Screen Recording"
                          : "Start Audio Recording"
                        : "Recording Disabled"}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* Active Recording Controls */}
            {isRecordingActive && (
              <div data-state-accent="true" className="mosaic-flat-card border border-slate-200 border-t-2 border-t-[#0078D4] bg-white p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className={`text-xl font-mono font-bold tabular-nums ${recorder.status === "paused" ? "text-amber-600" : "text-red-600"}`}>
                      {formatTime(recorder.elapsedSeconds)}
                    </span>
                    <span className={`ml-2 text-[10px] font-bold uppercase tracking-wider ${recorder.status === "paused" ? "text-amber-600" : "text-red-600"}`}>
                      {recorder.status === "paused" ? "Paused" : "Recording"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {recorder.status === "recording" ? (
                      <button
                        type="button"
                        onClick={recorder.pause}
                        className="h-7 px-2.5 border border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                        title="Pause recording"
                      >
                        <Pause size={12} /> Pause
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={recorder.resume}
                        className="h-7 px-2.5 border border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                        title="Resume recording"
                      >
                        <Play size={12} className="fill-current" /> Resume
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={recorder.stop}
                      className="h-7 px-3 border border-red-500 bg-red-600 text-white hover:bg-red-700 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                      title="Stop recording"
                    >
                      <Square size={11} className="fill-current" /> Stop
                    </button>
                  </div>
                </div>

                {/* Active Screen & Audio Status Details */}
                {recorder.screenInfo && (
                  <div className="bg-[#001E3C] text-white p-2 border-l-2 border-[#0078D4] text-[11px] space-y-0.5">
                    <div className="flex items-center gap-1.5 font-bold">
                      <Monitor size={12} className="text-[#0078D4] shrink-0" />
                      <span className="truncate">Recording: {recorder.screenInfo.screenName}</span>
                    </div>
                    <div className="text-[10px] text-[#0078D4] font-medium flex items-center justify-between">
                      <span>{recorder.screenInfo.audioStatusLabel}</span>
                      <span className="text-[9px] text-slate-300">Auto-saving to Documents/Mosaic Meetings</span>
                    </div>
                  </div>
                )}

                {/* Silence / Dead Mic Warning */}
                {recorder.isSilenceDetected && (
                  <div className="bg-amber-50 border border-amber-300 p-2 text-amber-800 text-[11px] flex items-center gap-1.5">
                    <AlertTriangle size={13} className="text-amber-600 shrink-0" />
                    <span>No audio detected from microphone. Check if your mic is muted.</span>
                  </div>
                )}

                {recorder.hasOtherTabRecording && (
                  <div className="bg-blue-50 border border-blue-200 p-2 text-blue-800 text-[11px] flex items-center gap-1.5">
                    <AlertCircle size={13} className="text-blue-600 shrink-0" />
                    <span>Notice: Another Mosaic tab is currently recording.</span>
                  </div>
                )}

                {recorder.status === "recording" && (
                  <div>
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Mic Input</span>
                      {visualizer.isClipping && <span className="text-[9px] font-bold text-red-600 uppercase">Clipping</span>}
                    </div>
                    <VolumeMeter level={visualizer.volumeLevel} isClipping={visualizer.isClipping} />
                  </div>
                )}

                <p className="text-[10px] text-slate-500 leading-tight">
                  {liveTranscript.status === "waiting" ? "Audio will be finalized when stopped." : liveTranscript.status === "processing" ? "Transcribing live segments…" : liveTranscript.status === "ready" ? "Ready for Notetaker" : liveTranscript.completedBatches > 0 ? `Context ready through ${formatTime(Math.min(recorder.elapsedSeconds, liveTranscript.processedSeconds))}` : "Recording live audio & building context"}
                </p>
              </div>
            )}

            {/* Stopped Recording Controls */}
            {isStopped && (
              <div data-state-accent="true" className="mosaic-flat-card border border-slate-200 border-t-2 border-t-emerald-600 bg-white p-2.5 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1">
                  <span>✓ {recorder.recordedFile?.type.startsWith("video/") || recorder.mediaType === "video" ? "Screen Recording Complete" : "Recording Complete"}</span>
                  <span className="font-mono">{formatTime(recorder.elapsedSeconds)}</span>
                </div>

                {recorder.localSaveStatus === "saving" && (
                  <div className="text-[10px] text-blue-800 bg-blue-50 border border-blue-200 p-1.5" role="status">
                    Saving to Documents/Mosaic Meetings…
                  </div>
                )}
                {recorder.localSaveStatus === "failed" && (
                  <div className="text-[10px] text-red-800 bg-red-50 border border-red-200 p-1.5" role="alert">
                    Automatic save failed. Use Download video copy to keep this recording.
                  </div>
                )}
                {recorder.localSaveStatus === "saved" && recorder.localSavedPath && (
                  <div className="text-[10px] text-emerald-700 bg-emerald-50/80 border border-emerald-200 p-1.5 truncate">
                    Saved to Documents/Mosaic Meetings: <span className="font-mono">{recorder.localSavedPath.split(/[/\\]/).pop()}</span>
                  </div>
                )}
                {recordingLocationError && <p className="text-[10px] text-red-700" role="alert">{recordingLocationError}</p>}

                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={handleSendToNotetaker}
                    disabled={isFinalizing}
                    className="w-full h-8 flex items-center justify-center gap-1.5 bg-[#003366] text-white hover:bg-[#002244] font-bold text-xs uppercase tracking-wider border border-[#0078D4] transition-colors disabled:opacity-40 cursor-pointer"
                  >
                    <Send size={12} />
                    {isFinalizing ? "Finishing…" : "Send to Notetaker"}
                  </button>
                  <div className="grid grid-cols-2 gap-1.5">
                    {isVideoRecording && recorder.localSavedPath ? (
                      <button
                        type="button"
                        onClick={() => void handleOpenRecordingLocation()}
                        disabled={isOpeningRecordingLocation}
                        className="h-7 inline-flex items-center justify-center gap-1 bg-white text-[#003366] font-semibold py-1 px-2 border border-slate-300 text-[11px] hover:border-[#003366] transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        <FolderOpen size={11} /> {isOpeningRecordingLocation ? "Opening…" : "Open file location"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSaveRecording}
                        disabled={isVideoRecording && recorder.localSaveStatus === "saving"}
                        className="h-7 inline-flex items-center justify-center gap-1 bg-white text-[#003366] font-semibold py-1 px-2 border border-slate-300 text-[11px] hover:border-[#003366] transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        <Download size={11} /> {isVideoRecording ? "Download video copy" : "Save Audio"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleDiscard}
                      className="h-7 inline-flex items-center justify-center gap-1 bg-white text-slate-600 font-semibold py-1 px-2 border border-slate-300 text-[11px] hover:text-red-600 hover:border-red-300 transition-colors cursor-pointer"
                    >
                      <Trash2 size={11} /> Discard
                    </button>
                  </div>
                </div>
              </div>
            )}

            {meetingDetails && (
              <details data-state-accent="true" className="mosaic-flat-card group border border-slate-200 border-t-2 border-t-[#0078D4] bg-white">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-[#003366] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0078D4] [&::-webkit-details-marker]:hidden">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em]">Meeting details</span>
                  <span className="flex items-center gap-2 text-[9px] text-slate-500">
                    Context for minutes <ChevronDown size={13} aria-hidden="true" className="transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                {meetingDetails}
              </details>
            )}

            {/* Error display */}
            {recorder.error && (
              <div
                role={recorder.error.startsWith("AUDIO_FILTER_WARNING:") ? "status" : "alert"}
                className={recorder.error.startsWith("AUDIO_FILTER_WARNING:")
                  ? "text-xs text-amber-900 bg-amber-50 border border-amber-300 px-3 py-2"
                  : "text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2"}
              >
                {recorder.error.startsWith("AUDIO_FILTER_WARNING:")
                  ? recorder.error.replace("AUDIO_FILTER_WARNING:", "Audio processing note:")
                  : recorder.error}
              </div>
            )}

            {/* Screen Share Ended Alert */}
            {recorder.captureIssue === "screen_share_ended" && (
              <div role="alert" className="border border-amber-300 border-l-4 border-l-[#0078D4] bg-amber-50 p-3 text-xs text-slate-700 shadow-2xs space-y-2">
                <div className="flex items-center gap-1.5 font-bold text-[#003366]">
                  <AlertCircle size={14} className="text-amber-600 shrink-0" />
                  <span>Screen sharing was stopped</span>
                </div>
                <p className="text-[11px] text-slate-600 leading-normal">
                  Your screen capture track ended. You can finish and assemble the recording now, or continue capturing audio with your microphone.
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={recorder.stop}
                    className="bg-[#003366] text-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider hover:bg-[#002244] transition-colors cursor-pointer"
                  >
                    Finish Recording
                  </button>
                  <button
                    type="button"
                    onClick={recorder.dismissCaptureIssue}
                    className="bg-white border border-slate-300 text-slate-700 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider hover:border-[#003366] transition-colors cursor-pointer"
                  >
                    Continue on Mic
                  </button>
                </div>
              </div>
            )}

            {/* Missing Shared Audio or Cancelled Alert */}
            {recorder.captureIssue && recorder.captureIssue !== "screen_share_ended" && (
              <div role="alert" className="border border-amber-300 border-l-4 border-l-[#0078D4] bg-amber-50 px-4 py-3 text-sm text-slate-700">
                <p className="font-semibold text-[#003366]">{recorder.captureIssue === "missing_shared_audio" ? "Meeting audio wasn’t shared" : "Nothing was shared"}</p>
                <p className="mt-1 text-xs leading-relaxed">Select the meeting tab/window and make sure to check “Share audio” in the browser prompt. Recording has not started.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void recorder.start()} className="bg-[#003366] px-3 py-2 text-xs font-semibold text-white cursor-pointer">Try Again</button>
                </div>
              </div>
            )}

            </div>
          </div>

          {isFullscreen && (
            <div id="meeting-notes-panel" role="region" aria-label="Notes" className={`mosaic-flat-card w-full min-w-0 min-h-0 lg:h-full lg:flex-none lg:border border-[#D9E1EA] bg-[#FFFCFB] ${mobilePanel === "notes" ? "flex" : "hidden lg:flex"} flex-1 flex-col`}>
              <div className="px-3 py-2 border-b border-slate-200 bg-white shrink-0 flex items-center justify-between min-h-11">
                <div>
                  <h3 className="text-sm font-semibold text-[#003366]">Notes</h3>
                </div>
                <span className="text-[11px] text-slate-500">
                  {notes.length} {notes.length === 1 ? "note" : "notes"}
                </span>
              </div>
              <div className={`flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-2 ${notes.length === 0 ? "flex flex-col" : ""}`}>
                {notes.length === 0 && (
                  <div className="m-auto w-full max-w-sm border border-dashed border-slate-300 bg-white/60 px-5 py-7 text-center">
                    <MessageCircle size={20} aria-hidden="true" className="mx-auto text-[#003366]"/>
                    <p className="mt-3 text-sm font-semibold text-slate-700">Capture decisions as they happen</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">Add a note below. Each note keeps its meeting timestamp.</p>
                  </div>
                )}
                {notes.map((note) => (
                  <div key={note.id} className="mosaic-flat-card group flex items-start gap-2.5 border border-slate-200 bg-white p-3">
                    <span className="text-[#003366] font-mono text-[11px] font-semibold shrink-0 border border-[#003366]/15 px-2 py-1 bg-slate-50">
                      {note.timestamp}
                    </span>
                    {editingNoteId === note.id ? (
                      <div className="flex-1 flex flex-col gap-2 min-w-0">
                        <textarea
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              saveEditingNote();
                            } else if (e.key === "Escape") {
                              cancelEditingNote();
                            }
                          }}
                          rows={2}
                          autoFocus
                          className="w-full text-xs p-1.5 border border-[#003366] rounded-none outline-none focus:ring-1 focus:ring-[#003366] bg-white resize-y"
                        />
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={cancelEditingNote}
                            className="px-2 py-1 text-[10px] text-slate-500 hover:text-slate-700 border border-slate-200"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={saveEditingNote}
                            disabled={!editingText.trim()}
                            className="px-2.5 py-1 text-[10px] font-semibold text-white bg-[#003366] hover:bg-[#002244] disabled:opacity-40 flex items-center gap-1"
                          >
                            <Check size={11} /> Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span className="text-sm text-slate-700 flex-1 leading-relaxed pt-0.5 break-words">
                          {note.text}
                        </span>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 shrink-0 transition-opacity">
                          <button
                            type="button"
                            onClick={() => startEditingNote(note)}
                            className="p-1 text-slate-400 hover:text-[#003366] transition-colors"
                            title="Edit note"
                            aria-label="Edit note"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeNote(note.id)}
                            className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                            title="Remove note"
                            aria-label="Remove note"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                <div ref={notesEndRef}/>
              </div>

              {/* Pinned Note Composer at bottom - always visible */}
              <div className="p-2.5 border-t border-slate-200 bg-white shrink-0">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    addNote();
                  }}
                  className="mosaic-flat-card flex flex-col gap-1.5 border border-slate-300 bg-white p-2 focus-within:border-[#0078D4]"
                >
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="font-mono text-[#003366] font-semibold">
                      {(recorder.status === "recording" || recorder.status === "paused")
                        ? `[${formatTime(recorder.elapsedSeconds)}]`
                        : "[00:00:00]"}
                    </span>
                    <span>Enter to add • Shift+Enter for newline</span>
                  </div>
                  <textarea
                    value={noteInput}
                    onChange={(event) => setNoteInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        addNote();
                      }
                    }}
                    rows={3}
                    placeholder="Write a decision, follow-up, or note…"
                    className="min-h-24 max-h-48 w-full resize-y bg-transparent text-sm leading-relaxed text-slate-800 outline-none placeholder:text-slate-400"
                  />
                  <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                    {noteInput.trim().length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setNoteInput("")}
                        className="text-[10px] text-slate-400 hover:text-red-500"
                      >
                        Clear
                      </button>
                    ) : <span />}
                    <button
                      type="submit"
                      disabled={!noteInput.trim()}
                      className="h-7 px-3 bg-[#003366] text-white text-xs font-semibold disabled:opacity-30 flex items-center gap-1 hover:bg-[#002244] transition-colors rounded-none"
                      aria-label="Add note"
                    >
                      <Plus size={13} />
                      <span>Add note</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* ── Right / Bottom: Ask Echo ───────────────────────── */}
          <div id="meeting-assistant-panel" role={isFullscreen ? "region" : undefined} aria-label={isFullscreen ? "Assistant" : undefined} className={`mosaic-flat-card ${canAskEcho && workspaceTab === "echo" ? "codex-chat" : ""} ${isFullscreen ? "w-full min-w-0 min-h-0 lg:h-full lg:flex-none lg:border" : "flex-1 border-t border-[#D9E1EA]"} ${isFullscreen && mobilePanel !== "assistant" ? "hidden lg:flex" : "flex"} flex-1 flex-col bg-[#FFFCFB]`}>
            <div className="px-3 py-2 shrink-0 bg-white border-b border-slate-200 flex items-center justify-between min-h-11">
              <div className="flex items-center gap-3">
                <div>
                  {canAskEcho ? (
                    <h3 className="text-sm font-semibold text-[#003366]">Meeting assistant</h3>
                  ) : (
                    <h3 className="text-lg font-semibold tracking-tight text-[#003366]">Transcript</h3>
                  )}
                  {!isFullscreen && <p className="text-xs text-slate-500 mt-0.5">Ask Echo about the transcript and notes.</p>}
                </div>
              </div>
              {canAskEcho && !isFullscreen && (
                <div className="flex gap-1" role="tablist" aria-label="Meeting workspace">
                  <button type="button" role="tab" aria-selected={workspaceTab === "notes"} onClick={() => setWorkspaceTab("notes")} className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 ${workspaceTab === "notes" ? "border-[#0078D4] text-[#003366]" : "border-transparent text-slate-400 hover:text-[#003366]"}`}><Plus size={13} /> Notes</button>
                  <button type="button" role="tab" aria-selected={workspaceTab === "echo"} onClick={() => setWorkspaceTab("echo")} className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 ${workspaceTab === "echo" ? "border-[#0078D4] text-[#003366]" : "border-transparent text-slate-400 hover:text-[#003366]"}`}><Sparkles size={13} /> Ask Echo</button>
                </div>
              )}
              {isFullscreen && canAskEcho && (
                <div className="flex gap-1 shrink-0" role="tablist" aria-label="Ask Echo workspace">
                  <button type="button" role="tab" aria-selected={workspaceTab === "echo"} onClick={() => setWorkspaceTab("echo")} className={`px-3 py-1.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${workspaceTab === "echo" ? "border-[#0078D4] text-[#003366]" : "border-transparent text-slate-400 hover:text-[#003366]"}`}>Ask Echo</button>
                  <button type="button" role="tab" aria-selected={workspaceTab === "transcript"} onClick={() => setWorkspaceTab("transcript")} className={`px-3 py-1.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${workspaceTab === "transcript" ? "border-[#0078D4] text-[#003366]" : "border-transparent text-slate-400 hover:text-[#003366]"}`}>Transcript</button>
                </div>
              )}
            </div>

            {isFullscreen && (!canAskEcho || workspaceTab === "transcript") ? <div className="flex-1 overflow-y-auto p-4 space-y-3"><div className="mb-3 text-[11px] font-semibold text-[#003366]">{liveTranscript.status === "processing" ? "Mosaic is transcribing…" : liveTranscript.completedBatches > 0 ? `Mosaic is caught up to ${formatTime(Math.min(recorder.elapsedSeconds, liveTranscript.processedSeconds))}` : "Mosaic is transcribing…"}</div><div className="space-y-3 text-sm leading-relaxed text-slate-700">{liveTranscript.segments.length ? liveTranscript.segments.map((segment) => <div key={segment.index}><span className="mr-2 font-mono text-[10px] text-[#003366]">[{formatTime(segment.startedAtSeconds)}]</span>{segment.text}</div>) : <p>Transcript chunks will appear here as Mosaic processes the meeting.</p>}</div></div> : workspaceTab === "notes" && !isFullscreen ? <>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                {notes.length === 0 && (
                  <div className="mx-auto mt-6 max-w-xs text-center">
                    <div className="mx-auto w-10 h-10 rounded-full bg-[#003366]/[0.06] text-[#003366] flex items-center justify-center"><MessageCircle size={18} /></div>
                    <p className="text-sm font-medium text-slate-600 mt-3">Keep the moments that matter</p>
                    <p className="text-xs text-slate-400 mt-1">Decisions, follow-ups, and observations will stay linked to the exact moment.</p>
                  </div>
                )}
                {notes.map((note) => (
                  <div key={note.id} className="mosaic-flat-card group flex items-start gap-3 text-xs border border-slate-200 bg-white px-3.5 py-3">
                    <span className="text-[#003366] font-mono font-semibold shrink-0 bg-[#003366]/[0.06] px-2 py-1">{note.timestamp}</span>
                    <span className="text-[#181D1E] flex-1 leading-relaxed pt-1">{note.text}</span>
                    <button type="button" onClick={() => removeNote(note.id)} className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-gray-400 hover:text-red-500 shrink-0 transition-opacity" title="Remove note"><X size={12} /></button>
                  </div>
                ))}
                <div ref={notesEndRef} />
              </div>
              <div className="px-5 py-3 border-t border-gray-200 bg-white shrink-0">
                <form onSubmit={(e) => { e.preventDefault(); addNote(); }} className="mosaic-flat-card flex items-center gap-2 border border-slate-200 bg-white px-2 py-1 focus-within:border-[#0078D4]">
                  <span className="text-[11px] font-mono text-[#003366] font-semibold shrink-0 bg-[#003366]/[0.06] px-2 py-1">
                    {(recorder.status === "recording" || recorder.status === "paused")
                      ? `[${formatTime(recorder.elapsedSeconds)}]`
                      : "[00:00]"}
                  </span>
                  <textarea rows={3} value={noteInput} onChange={(e) => setNoteInput(e.target.value)} placeholder="Write a decision, follow-up, or thought…" className="min-h-20 flex-1 resize-y text-xs bg-transparent px-1 py-2 outline-none" />
                  <button type="submit" disabled={!noteInput.trim()} className="w-8 h-8 bg-[#003366] text-white disabled:opacity-30 flex items-center justify-center" title="Add note"><Plus size={15} /></button>
                </form>
              </div>
            </> : <EchoAI visible={canAskEcho} compact context={echoMeetingContext} prompts={["Summarize this meeting so far", "What decisions are emerging?", "List open follow-ups"]} />}
          </div>
        </div>
      </section>

      {displayCaptureRequest && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#001A33]/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="display-capture-title">
          <div className="flex max-h-[88vh] w-full max-w-5xl flex-col border border-[#0078D4] bg-[#FFFCFB] shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#0078D4]">Meeting recording</p>
                <h2 id="display-capture-title" className="mt-1 font-serif text-xl font-bold italic text-[#003366]">Choose a screen or window</h2>
                <p className="mt-1 text-sm text-slate-600">System audio is included automatically.</p>
              </div>
              <button type="button" onClick={() => void respondToDisplayCapture(null)} className="grid h-9 w-9 shrink-0 place-items-center border border-slate-300 text-slate-600 hover:border-[#003366] hover:text-[#003366]" aria-label="Cancel screen selection">
                <X size={17} />
              </button>
            </header>

            <div className="min-h-0 overflow-y-auto p-4 sm:p-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {displayCaptureRequest.sources.map((source) => {
                  const isScreen = source.id.startsWith("screen:");
                  const isSelected = selectedDisplaySourceId === source.id;
                  return (
                    <button
                      key={source.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedDisplaySourceId(source.id)}
                      className={`overflow-hidden border text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0078D4] ${isSelected ? "border-[#0078D4] ring-2 ring-[#0078D4]/40" : "border-slate-200 hover:border-[#31577D]"}`}
                    >
                      <div className="relative aspect-video bg-slate-100">
                        <img src={source.thumbnail} alt="" className="h-full w-full object-contain" />
                        {source.appIcon && <img src={source.appIcon} alt="" className="absolute bottom-2 left-2 h-7 w-7 border border-white bg-white p-0.5 shadow" />}
                      </div>
                      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <span className="min-w-0 truncate text-sm font-semibold text-[#003366]">{source.name}</span>
                        <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-[#31577D]">{isScreen ? "Screen" : "Window"}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
              {displayCaptureError && <p className="mt-3 text-sm text-red-700" role="alert">{displayCaptureError}</p>}
            </div>

            <footer className="flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
              <button type="button" onClick={() => void respondToDisplayCapture(null)} className="border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:border-[#003366]">Cancel</button>
              <button type="button" onClick={() => void respondToDisplayCapture(selectedDisplaySourceId)} disabled={!selectedDisplaySourceId} className="border border-[#0078D4] bg-[#003366] px-5 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-[#002244] disabled:opacity-40">
                Share {selectedDisplaySourceId?.startsWith("screen:") ? "screen" : "window"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {showCloseConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#001E3C]/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="close-recording-title">
          <div className="w-full max-w-sm border border-[#0078D4] bg-[#FFFCFB] p-5 shadow-2xl">
            <h3 id="close-recording-title" className="text-lg font-semibold text-[#003366]">Recording is still active</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">Stop the recording before closing Studio so your audio stays safe.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCloseConfirm(false)} className="px-3 py-2 text-xs font-semibold text-slate-600">Keep recording</button>
              <button type="button" onClick={() => { recorder.stop(); setShowCloseConfirm(false); onClose(); }} className="border border-red-500 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700">Stop and close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
