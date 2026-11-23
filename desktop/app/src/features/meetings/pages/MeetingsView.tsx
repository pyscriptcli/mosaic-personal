"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  Search, 
  Plus, 
  Calendar, 
  FileText, 
  Download, 
  Sparkles, 
  Send, 
  Loader2, 
  Save, 
  ChevronUp, 
  ChevronDown, 
  X, 
  Users, 
  Building2, 
  Clock, 
  Trash2,
  CheckCircle,
  FileSpreadsheet,
  AlertCircle,
  CheckSquare,
  Info,
  ExternalLink,
  Lock,
  FolderInput,
  PhilippinePeso,
  Mic,
  Video,
  MessageCircle,
  Copy,
  Check,
  AlertTriangle,
  Archive
} from "lucide-react";
import { ArchivedMeeting, DiscussionItem, MeetingActionItem } from "@/features/meetings/types/meeting";
import { MeetingWorkspaceTabs, type MeetingWorkspaceTab } from "@/features/meetings/components/MeetingWorkspaceTabs";
import { MeetingActionItemsTable, MeetingDiscussionCard, MeetingSummaryEditor, useMeetingAssignees } from "@/features/meetings/components/MeetingWorkspaceContent";
import { createActionFromDiscussion } from "@/features/meetings/lib/meetingArchive";
import type { StudioSession } from "@/features/notetaker/types/studio";
import { getInterruptedSessions, downloadSession, clearSession, exportSessionAsFile, saveToLocalDocuments } from "@/features/notetaker/lib/studioStorage";
import { exportWord, exportPdf, discoverClickUpLists } from "@/lib/api";
import { useEchoAI } from "@/features/ask-echo/components/EchoAI";
import { QuickAddTaskModal } from "@/components/QuickAddTaskModal";
import { EmailMeetingModal } from "@/features/meetings/components/EmailMeetingModal";
import { MoveMeetingModal } from "@/features/meetings/components/MoveMeetingModal";
import { DiscoverTopicsModal } from "@/features/meetings/components/DiscoverTopicsModal";
import type { DiscoveredTopicItem } from "@/app/api/discover-topics/route";
import { formatEchoDate } from "@/lib/dateUtils";

const VENUE_OPTIONS = [
  "GreatWork Mega Tower 32F - Secret Room",
  "GreatWork Mega Tower 32F - Small Meeting Room",
  "GreatWork Mega Tower 24F - Meeting Room",
  "GreatWork Mega Tower 32F - Board Room",
  "GreatWork Mega Tower 32F - Co-working",
  "Online Meeting",
  "Other / Custom..."
];

function AutoResizeTextarea({
  value,
  onChange,
  placeholder,
  className = "",
  rows = 1,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      rows={rows}
      value={value}
      onChange={(e) => {
        onChange(e);
        adjustHeight();
      }}
      placeholder={placeholder}
      className={`resize-none overflow-hidden ${className}`}
    />
  );
}

function DatePickerInput({
  value,
  onChange,
  placeholder = "YYYY-MM-DD or TBD",
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
}) {
  const dateInputRef = useRef<HTMLInputElement>(null);

  const handleIconClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (dateInputRef.current) {
      try {
        if (typeof dateInputRef.current.showPicker === "function") {
          dateInputRef.current.showPicker();
        } else {
          dateInputRef.current.focus();
        }
      } catch {
        dateInputRef.current.focus();
      }
    }
  };

  return (
    <div className="relative flex items-center">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full text-xs bg-surface-panel border border-line rounded-none px-2 py-1 pr-7 focus:outline-none focus:border-focus"
      />
      <input
        type="date"
        ref={dateInputRef}
        onChange={(e) => {
          if (e.target.value) {
            onChange(e.target.value);
          }
        }}
        tabIndex={-1}
        className="absolute inset-0 opacity-0 pointer-events-none w-full h-full"
      />
      <button
        type="button"
        onClick={handleIconClick}
        title="Choose date from calendar"
        className="absolute right-1 text-fg-muted hover:text-fg p-1 cursor-pointer"
      >
        <Calendar size={13} />
      </button>
    </div>
  );
}

const TOTAL_AI_PHP_PER_HOUR = 2.53;
const desktopMode = process.env.NEXT_PUBLIC_MOSAIC_DESKTOP === "1";

function getMeetingDurationMinutes(m: ArchivedMeeting): number {
  if (typeof m.duration_minutes === "number" && m.duration_minutes > 0) return m.duration_minutes;
  if (typeof m.duration_seconds === "number" && m.duration_seconds > 0) return Math.max(1, Math.round(m.duration_seconds / 60));
  const sm = m.start_time;
  const em = m.end_time;
  if (sm && em) {
    const [sh, smin] = sm.split(":").map(Number);
    const [eh, emin] = em.split(":").map(Number);
    if (!isNaN(sh) && !isNaN(smin) && !isNaN(eh) && !isNaN(emin)) {
      const diff = (eh * 60 + emin) - (sh * 60 + smin);
      if (diff > 0) return diff;
    }
  }
  if (m.transcript && m.transcript.trim().length > 0) {
    const words = m.transcript.trim().split(/\s+/).length;
    return Math.max(5, Math.round(words / 130));
  }
  return 30;
}

function formatDisplayTime(timeStr?: string): string {
  if (!timeStr || timeStr.trim() === "" || timeStr === "—") return "—";
  const trimmed = timeStr.trim();
  if (/am|pm/i.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    let hours = parseInt(match[1], 10);
    const mins = match[2];
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${hours}:${mins} ${ampm}`;
  }
  return trimmed;
}

interface MeetingsViewProps {
  meetings: ArchivedMeeting[];
  selectedMeetingId: string | null;
  onSelectMeeting: (id: string) => void;
  onUpdateMeeting: (meeting: ArchivedMeeting, previousMeeting?: ArchivedMeeting) => Promise<void>;
  onDeleteMeeting?: (meetingId: string) => Promise<void>;
  onMoveMeeting?: (updatedMeeting: ArchivedMeeting) => Promise<void> | void;
  onProcessInterrupted?: (file: File, notes?: string) => void;
  onNavigateToTasks?: (taskId: string) => void;
  onSelectMeetingSpace?: (spaceId: string) => void;
  userEmail?: string;
  canExport?: boolean;
}

export function MeetingsView({
  meetings,
  selectedMeetingId,
  onSelectMeeting,
  onUpdateMeeting,
  onDeleteMeeting,
  onMoveMeeting,
  onProcessInterrupted,
  onNavigateToTasks,
  onSelectMeetingSpace,
  userEmail,
  canExport = true
}: MeetingsViewProps) {
  const { runStructured } = useEchoAI();
  // Search & Filter state
  const [searchFilter, setSearchFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<"All" | "Internal" | "External" | "Archives">("All");
  const [meetingSpaces, setMeetingSpaces] = useState<Array<{ id: string; name: string; teamName: string }>>([]);
  const [selectedMeetingSpace, setSelectedMeetingSpace] = useState("__all__");
  const [personalListId, setPersonalListId] = useState<string>("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [interruptedSessions, setInterruptedSessions] = useState<StudioSession[]>([]);
  const [selectedInterruptedId, setSelectedInterruptedId] = useState<string | null>(null);
  const [isProcessingInterrupted, setIsProcessingInterrupted] = useState<string | null>(null);

  useEffect(() => {
    if (desktopMode) return;
    const storedPId = typeof window !== "undefined" ? localStorage.getItem("project_echo_personal_list_id") || "" : "";
    if (storedPId) {
      setPersonalListId(storedPId);
    }
    discoverClickUpLists().then((data) => {
      setMeetingSpaces(data.spaces || []);
      onSelectMeetingSpace?.("__all__");
    }).catch(() => setMeetingSpaces([]));
  }, []);

  // Selected meeting working draft (for in-place editing)
  const currentMeeting = meetings.find((m) => m.id === selectedMeetingId) || meetings[0];
  const [activeMeeting, setActiveMeeting] = useState<ArchivedMeeting | null>(currentMeeting || null);

  // Sync draft when selectedMeetingId changes
  useEffect(() => {
    if (currentMeeting) {
      setActiveMeeting(JSON.parse(JSON.stringify(currentMeeting)));
    }
  }, [selectedMeetingId, meetings]);

  // Venue custom helper
  const [isCustomVenue, setIsCustomVenue] = useState(false);

  useEffect(() => {
    if (activeMeeting) {
      const isKnown = VENUE_OPTIONS.slice(0, -1).includes(activeMeeting.location);
      setIsCustomVenue(!isKnown && !!activeMeeting.location);
    }
  }, [activeMeeting?.id]);

  // Attendee input tags
  const [primeInput, setPrimeInput] = useState("");
  const [externalInput, setExternalInput] = useState("");

  const [isExporting, setIsExporting] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState(false);
  const [showArchiveDetails, setShowArchiveDetails] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [detailTab, setDetailTab] = useState<MeetingWorkspaceTab>("summary");
  const meetingAssignees = useMeetingAssignees(detailTab === "actions");
  const [showDiscoverTopicsModal, setShowDiscoverTopicsModal] = useState(false);
  const [missedTopics, setMissedTopics] = useState<DiscoveredTopicItem[]>([]);
  const [topicQuery, setTopicQuery] = useState("");
  const [isDiscoveringTopics, setIsDiscoveringTopics] = useState(false);
  const [autoDiscoverEnabled, setAutoDiscoverEnabled] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [localRecordingFiles, setLocalRecordingFiles] = useState<Array<{ name: string; size: number; path: string; modifiedAt?: string; isCheckpoint?: boolean; conversionState?: "queued" | "converting" | "ready" | "failed"; conversionProgress?: number; conversionError?: string; conversionJobId?: string }>>([]);
  const [conversionPaused, setConversionPaused] = useState(false);

  // Fetch recordings from the active and legacy local storage folders
  const refreshLocalRecordings = React.useCallback(() => {
    fetch("/api/recordings/save-local")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.files)) {
          setLocalRecordingFiles(data.files);
          setConversionPaused(data.conversionsPaused === true);
        }
      })
      .catch(() => {});
  }, []);

  const controlConversions = React.useCallback(async (action: "pause" | "resume" | "retry", jobId?: string) => {
    try {
      const response = await fetch("/api/recordings/conversion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, jobId }),
      });
      if (!response.ok) throw new Error("Conversion control request failed.");
      const result = await response.json() as { paused?: boolean };
      setConversionPaused(result.paused === true);
      refreshLocalRecordings();
    } catch (error) {
      console.error("[MeetingsView] Could not update recording conversion:", error);
    }
  }, [refreshLocalRecordings]);

  const refreshInterruptedSessions = React.useCallback(() => {
    getInterruptedSessions()
      .then((records) => {
        setInterruptedSessions(records);
        if (records.length > 0 && !selectedInterruptedId) {
          setSelectedInterruptedId(records[0].sessionId);
        }
      })
      .catch(() => {});
    refreshLocalRecordings();
  }, [selectedInterruptedId, refreshLocalRecordings]);

  useEffect(() => {
    refreshLocalRecordings();
    refreshInterruptedSessions();
  }, [refreshLocalRecordings, refreshInterruptedSessions]);

  useEffect(() => {
    if (typeFilter !== "Archives") return;
    const interval = window.setInterval(() => {
      if (localRecordingFiles.some((file) => file.conversionState === "queued" || file.conversionState === "converting")) refreshLocalRecordings();
    }, 2500);
    return () => window.clearInterval(interval);
  }, [typeFilter, localRecordingFiles, refreshLocalRecordings]);

  // When switching to Archives pill, ensure interrupted records are refreshed
  useEffect(() => {
    if (typeFilter === "Archives") {
      refreshInterruptedSessions();
    }
  }, [typeFilter, refreshInterruptedSessions]);

  // Determine matched local audio or video recording for the active meeting
  const matchedRecording = React.useMemo(() => {
    if (!activeMeeting || localRecordingFiles.length === 0) return null;
    const meetingDate = activeMeeting.date?.trim();
    const titleTokens = (activeMeeting.title || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((tok) => tok.length >= 3 && !["meeting", "echo", "prime", "the", "and", "internal"].includes(tok));

    // 1. Exact or date match + token match
    let match = localRecordingFiles.find((f) => {
      const lower = f.name.toLowerCase();
      if (meetingDate && lower.includes(meetingDate)) {
        if (titleTokens.length > 0 && titleTokens.some((t) => lower.includes(t))) return true;
        return true;
      }
      return false;
    });

    // 2. Token match on title
    if (!match && titleTokens.length > 0) {
      match = localRecordingFiles.find((f) => {
        const lower = f.name.toLowerCase();
        return titleTokens.some((t) => lower.includes(t));
      });
    }

    // 3. Normalized string match
    if (!match) {
      const titleClean = activeMeeting.title.toLowerCase().replace(/[^a-z0-9]/g, "");
      match = localRecordingFiles.find((f) => {
        const fileClean = f.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (titleClean && titleClean.length > 4 && fileClean.includes(titleClean.slice(0, 10))) return true;
        return false;
      });
    }

    return match || null;
  }, [activeMeeting, localRecordingFiles]);

  const recordingType = React.useMemo<"video" | "audio">(() => {
    if (activeMeeting?.recording_type === "video") return "video";
    if (activeMeeting?.recording_type === "audio") return "audio";
    if (matchedRecording) {
      const lower = matchedRecording.name.toLowerCase();
      if (lower.endsWith(".mp4") || lower.endsWith(".mov") || lower.endsWith(".mkv") || lower.includes("video") || lower.includes("screen")) {
        return "video";
      }
      return "audio";
    }
    const combined = `${activeMeeting?.title || ""} ${activeMeeting?.location || ""} ${activeMeeting?.summary || ""}`.toLowerCase();
    if (combined.includes("screen recording") || combined.includes("video") || combined.includes("zoom") || combined.includes("meet")) {
      return "video";
    }
    return "audio";
  }, [activeMeeting, matchedRecording]);

  const recordingFormat = React.useMemo<string>(() => {
    if (matchedRecording) {
      const parts = matchedRecording.name.split(".");
      if (parts.length > 1) return parts[parts.length - 1].toLowerCase();
    }
    if (activeMeeting?.recording_format) return activeMeeting.recording_format;
    return recordingType === "video" ? "webm" : "mp3";
  }, [matchedRecording, activeMeeting, recordingType]);

  const handleExportRecording = () => {
    if (matchedRecording) {
      const downloadUrl = `/api/recordings/download?fileName=${encodeURIComponent(matchedRecording.name)}`;
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = matchedRecording.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }

    if (localRecordingFiles.length > 0) {
      const fallback = localRecordingFiles.find((f) => {
        const lower = f.name.toLowerCase();
        return recordingType === "video"
          ? (lower.endsWith(".mp4") || lower.endsWith(".webm") || lower.includes("video"))
          : (lower.endsWith(".mp3") || lower.endsWith(".wav") || lower.endsWith(".m4a") || lower.endsWith(".webm"));
      });
      if (fallback) {
        const downloadUrl = `/api/recordings/download?fileName=${encodeURIComponent(fallback.name)}`;
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = fallback.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        return;
      }
    }

    alert(`No local ${recordingType === "video" ? "video" : "audio"} recording was found for this meeting.`);
  };

  const handleDownloadMatchedRecording = () => {
    handleExportRecording();
  };

  // Handlers for Interrupted Meetings / Archives
  const handleProcessInterruptedSession = async (session: StudioSession) => {
    setIsProcessingInterrupted(session.sessionId);
    try {
      const rawFile = await exportSessionAsFile(session.sessionId);
      const saved = await saveToLocalDocuments(session.sessionId, rawFile, "completed", session.mediaType || "audio", rawFile.name, session.notes, true);
      if (!saved.success || !saved.file) throw new Error("Recording conversion did not finish.");
      const notesFormatted = session.notes && session.notes.length > 0
        ? session.notes.map((n) => `[${n.timestamp}] ${n.text}`).join("\n")
        : "";
      if (onProcessInterrupted) {
        onProcessInterrupted(saved.file, notesFormatted);
      }
      await clearSession(session.sessionId);
      refreshInterruptedSessions();
    } catch (err) {
      console.error("[MeetingsView] Processing interrupted session failed:", err);
      alert("Failed to assemble and process interrupted recording.");
    } finally {
      setIsProcessingInterrupted(null);
    }
  };

  const handleDownloadInterruptedSession = async (sessionId: string) => {
    try {
      await downloadSession(sessionId);
    } catch (err) {
      console.error("[MeetingsView] Download interrupted session failed:", err);
      alert("Failed to download interrupted session.");
    }
  };

  const handleDiscardInterruptedSession = async (sessionId: string) => {
    if (!confirm("Are you sure you want to discard this interrupted meeting recording? This action cannot be undone.")) {
      return;
    }
    try {
      await clearSession(sessionId);
      refreshInterruptedSessions();
      if (selectedInterruptedId === sessionId) {
        setSelectedInterruptedId(null);
      }
    } catch (err) {
      console.error("[MeetingsView] Discard interrupted session failed:", err);
      alert("Failed to discard session.");
    }
  };

  const handleProcessLocalInterruptedFile = async (fileName: string) => {
    setIsProcessingInterrupted(fileName);
    try {
      const res = await fetch(`/api/recordings/download?fileName=${encodeURIComponent(fileName)}`);
      if (!res.ok) throw new Error("Failed to fetch recording file");
      const blob = await res.blob();
      const ext = fileName.split(".").pop()?.toLowerCase();
      const mime = ext === "mp4" ? "video/mp4" : ext === "mp3" ? "audio/mpeg" : ext === "wav" ? "audio/wav" : ext === "m4a" ? "audio/mp4" : "video/webm";
      const file = new File([blob], fileName, { type: blob.type || mime });
      if (onProcessInterrupted) {
        onProcessInterrupted(file);
      }
    } catch (err) {
      console.error("[MeetingsView] Failed to process local interrupted file:", err);
      alert("Failed to load local recording file for processing.");
    } finally {
      setIsProcessingInterrupted(null);
    }
  };

  const handleDownloadLocalInterruptedFile = (fileName: string) => {
    const downloadUrl = `/api/recordings/download?fileName=${encodeURIComponent(fileName)}`;
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleDiscardLocalInterruptedFile = async (fileName: string) => {
    if (!confirm(`Are you sure you want to delete "${fileName}" from local recording storage?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/recordings/save-local?fileName=${encodeURIComponent(fileName)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete request failed");
      refreshLocalRecordings();
      if (selectedInterruptedId === fileName) {
        setSelectedInterruptedId(null);
      }
    } catch (err) {
      console.error("[MeetingsView] Failed to delete file:", err);
      alert("Failed to delete local interrupted file.");
    }
  };

  // Quick Add ClickUp Task state
  const [quickAddTaskData, setQuickAddTaskData] = useState<{
    isOpen: boolean;
    data: {
      name?: string;
      description?: string;
      meetingTitle?: string;
      meetingDate?: string;
      dueDate?: string;
      priority?: string;
      assigneeName?: string;
      assigneeId?: string;
      assigneeIds?: string[];
      topic?: string;
      evidence?: string;
      discussionPointId?: string;
      existingTaskId?: string;
      existingTaskUrl?: string;
    };
    actionIndex?: number;
  }>({
    isOpen: false,
    data: {},
  });

  // Filter master list
  const filteredList = meetings.filter((m) => {
    const matchesSearch =
      m.title.toLowerCase().includes(searchFilter.toLowerCase()) ||
      m.location.toLowerCase().includes(searchFilter.toLowerCase()) ||
      m.summary.toLowerCase().includes(searchFilter.toLowerCase());
    const matchesType = typeFilter === "All" || m.meeting_type === typeFilter;
    const matchesFrom = !fromDate || m.date >= fromDate;
    const matchesTo = !toDate || m.date <= toDate;
    const matchesSpace = desktopMode ||
      selectedMeetingSpace === "__all__" || !selectedMeetingSpace
        ? true
        : selectedMeetingSpace === "__personal__"
        ? m.is_confidential === true || m.clickup_space_id === "__personal__" || (Boolean(personalListId) && m.clickup_list_id === personalListId)
        : m.clickup_space_id === selectedMeetingSpace && !m.is_confidential;
    return matchesSearch && matchesType && matchesFrom && matchesTo && matchesSpace;
  });

  // Interrupted records combining IndexedDB sessions and local interrupted files
  const interruptedItems = React.useMemo(() => {
    type UnifiedInterrupted = {
      id: string;
      kind: "indexeddb" | "local_file";
      title: string;
      date: string;
      durationSeconds: number;
      mediaType: "video" | "audio";
      recordingState: "saved" | "interrupted" | "checkpoint";
      fileSize?: number;
      session?: StudioSession;
      fileName?: string;
      conversionState?: "queued" | "converting" | "ready" | "failed";
      conversionProgress?: number;
      conversionError?: string;
      conversionJobId?: string;
      noteCount: number;
    };

    const list: UnifiedInterrupted[] = [];
    const lowerSearch = searchFilter.toLowerCase();

    // 1. IndexedDB Interrupted Sessions
    for (const s of interruptedSessions) {
      const isVideo = s.mediaType === "video";
      const title = `Interrupted Session (${s.sessionId.slice(-6)})`;
      if (lowerSearch && !title.toLowerCase().includes(lowerSearch) && !s.sessionId.toLowerCase().includes(lowerSearch)) {
        continue;
      }
      list.push({
        id: s.sessionId,
        kind: "indexeddb",
        title,
        date: s.startedAt ? s.startedAt.split("T")[0] : "",
        durationSeconds: s.elapsedSeconds || 0,
        mediaType: isVideo ? "video" : "audio",
        recordingState: "interrupted",
        session: s,
        noteCount: s.notes ? s.notes.length : 0,
      });
    }

    // 2. Local recordings in the active and legacy folders, including completed recordings.
    for (const f of localRecordingFiles) {
      const isInterruptedFile = f.name.startsWith("INTERRUPTED_");
      const isCheckpointFile = f.name.startsWith("CHECKPOINT_") || f.isCheckpoint === true;
      const isSavedRecording = /\.(webm|mp4|mp3|wav|m4a|ogg|aac)$/i.test(f.name);
      if (!isInterruptedFile && !isCheckpointFile && !isSavedRecording) continue;

      // Avoid duplicate card if already represented in IndexedDB session
      const matchingIndexedDb = interruptedSessions.find((s) => f.name.includes(s.sessionId));
      if (matchingIndexedDb) continue;

      if (lowerSearch && !f.name.toLowerCase().includes(lowerSearch)) {
        continue;
      }

      const isVideo = /\.mp4$/i.test(f.name) || (/\.webm$/i.test(f.name) && f.name.toLowerCase().includes("video"));
      const recordingState = isInterruptedFile ? "interrupted" : isCheckpointFile ? "checkpoint" : "saved";
      const title = recordingState === "interrupted" ? `Interrupted: ${f.name}` : recordingState === "checkpoint" ? `Checkpoint: ${f.name}` : f.name;

      list.push({
        id: f.name,
        kind: "local_file",
        title,
        date: f.modifiedAt ? f.modifiedAt.split("T")[0] : "",
        durationSeconds: 0,
        mediaType: isVideo ? "video" : "audio",
        recordingState,
        fileSize: f.size,
        fileName: f.name,
        conversionState: f.conversionState,
        conversionProgress: f.conversionProgress,
        conversionError: f.conversionError,
        conversionJobId: f.conversionJobId,
        noteCount: 0,
      });
    }

    return list;
  }, [interruptedSessions, localRecordingFiles, searchFilter]);

  const activeInterruptedItem = React.useMemo(() => {
    if (!selectedInterruptedId && interruptedItems.length > 0) {
      return interruptedItems[0];
    }
    return interruptedItems.find((it) => it.id === selectedInterruptedId) || null;
  }, [selectedInterruptedId, interruptedItems]);

  // Handle Discussion Items Reorder / Remove / Add
  const handleMoveItem = (index: number, direction: "up" | "down") => {
    if (!activeMeeting) return;
    const newItems = [...activeMeeting.items];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newItems.length) return;
    const temp = newItems[index];
    newItems[index] = newItems[targetIndex];
    newItems[targetIndex] = temp;
    setActiveMeeting({ ...activeMeeting, items: newItems });
  };

  const handleRemoveItem = (index: number) => {
    if (!activeMeeting) return;
    const newItems = activeMeeting.items.filter((_, i) => i !== index);
    setActiveMeeting({ ...activeMeeting, items: newItems });
  };

  const handleUpdateItem = (index: number, field: keyof DiscussionItem, value: string) => {
    if (!activeMeeting) return;
    const newItems = [...activeMeeting.items];
    newItems[index] = { ...newItems[index], [field]: value };
    setActiveMeeting({ ...activeMeeting, items: newItems });
  };

  const handleAddNewItem = () => {
    if (!activeMeeting) return;
    const newItem: DiscussionItem = {
      id: `item-${Date.now()}`,
      topic: "New Discussion Topic",
      evidence: "",
      discussion_point: "",
    };
    setActiveMeeting({ ...activeMeeting, items: [...activeMeeting.items, newItem] });
  };

  const handleAddAction = (discussion: DiscussionItem) => {
    if (!activeMeeting) return;
    const action = createActionFromDiscussion(discussion, `action-${Date.now()}-${(activeMeeting.action_items || []).length}`);
    setActiveMeeting({ ...activeMeeting, action_items: [...(activeMeeting.action_items || []), action] });
    setDetailTab("actions");
  };

  const handleUpdateAction = (id: string, field: "actionPlan" | "targetDate" | "personInCharge", value: string, assigneeIds?: string[]) => {
    if (!activeMeeting) return;
    const key = { actionPlan: "action_plan", targetDate: "target_date", personInCharge: "person_in_charge" }[field] as "action_plan" | "target_date" | "person_in_charge";
    const updated = { ...activeMeeting, action_items: (activeMeeting.action_items || []).map((action) => String(action.id) === id ? { ...action, [key]: value, ...(field === "personInCharge" ? { assignee_ids: assigneeIds || [], assignee_id: assigneeIds?.[0] } : {}) } : action) };
    setActiveMeeting(updated);
  };

  // Add Attendee Handlers
  const handleAddPrimeAttendee = () => {
    if (!activeMeeting || !primeInput.trim()) return;
    const current = activeMeeting.attendees_prime || [];
    if (!current.includes(primeInput.trim())) {
      setActiveMeeting({ ...activeMeeting, attendees_prime: [...current, primeInput.trim()] });
    }
    setPrimeInput("");
  };

  const handleRemovePrimeAttendee = (name: string) => {
    if (!activeMeeting) return;
    setActiveMeeting({
      ...activeMeeting,
      attendees_prime: (activeMeeting.attendees_prime || []).filter((a) => a !== name)
    });
  };

  const handleAddExternalAttendee = () => {
    if (!activeMeeting || !externalInput.trim()) return;
    const current = activeMeeting.attendees_external || [];
    if (!current.includes(externalInput.trim())) {
      setActiveMeeting({ ...activeMeeting, attendees_external: [...current, externalInput.trim()] });
    }
    setExternalInput("");
  };

  const handleRemoveExternalAttendee = (name: string) => {
    if (!activeMeeting) return;
    setActiveMeeting({
      ...activeMeeting,
      attendees_external: (activeMeeting.attendees_external || []).filter((a) => a !== name)
    });
  };

  // Save changes
  const handleSaveChanges = async () => {
    if (!activeMeeting) return;
    try {
      await onUpdateMeeting(activeMeeting, currentMeeting || undefined);
      setSaveSuccessMsg(true);
      setTimeout(() => setSaveSuccessMsg(false), 3000);
    } catch (error: any) {
      alert(error.message || "Unable to save changes to ClickUp.");
    }
  };

  const handleDiscoverTopics = async (queryOverride?: string) => {
    if (!activeMeeting?.transcript?.trim()) {
      alert("No transcript found for this meeting archive.");
      return;
    }
    if (isDiscoveringTopics) return;
    setIsDiscoveringTopics(true);
    const activeQuery = queryOverride !== undefined ? queryOverride : topicQuery;
    try {
      const data = await runStructured<{ topics: DiscoveredTopicItem[] }>(
        `Find material discussion points missing from the current minutes. ${activeQuery?.trim() ? `Focus the review on: ${activeQuery.trim()}.` : "Review the whole transcript."} Exclude topics already covered. Return JSON {"topics":[...]}; each item must have topic_title, discussion_point, evidence_quote, action_plan, indicative_delivery_date, person_in_charge, confidence (High, Medium, or Low). Only include source-supported decisions, actions, risks, open questions, or important context. Existing topics: ${(activeMeeting.items || []).map((item) => item.topic).join("; ") || "none"}.`,
        `<meeting_notes>\n${activeMeeting.meeting_notes || ""}\n</meeting_notes>\n\n<transcript>\n${activeMeeting.transcript}\n</transcript>`,
      );
      const incomingList: DiscoveredTopicItem[] = data.topics || [];
      if (activeQuery?.trim() && missedTopics.length > 0) {
        const existingSet = new Set(missedTopics.map((t) => t.topic_title.toLowerCase().trim()));
        const uniqueIncoming = incomingList.filter((t) => !existingSet.has(t.topic_title.toLowerCase().trim()));
        setMissedTopics([...uniqueIncoming, ...missedTopics]);
      } else {
        setMissedTopics(incomingList);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to discover topics.");
    } finally {
      setIsDiscoveringTopics(false);
    }
  };

  const handleAddDiscoveredTopic = (index: number = 0) => {
    if (!activeMeeting) return;
    const suggestion = missedTopics[index];
    if (!suggestion) return;
    const newItem: DiscussionItem = {
      id: `dp_${Date.now()}_${activeMeeting.items.length}`,
      topic: suggestion.topic_title,
      evidence: suggestion.evidence_quote || "",
      discussion_point: suggestion.discussion_point || "Review and complete the discussion details.",
      action_suggestion: { action_plan: suggestion.action_plan || "", target_date: suggestion.indicative_delivery_date || "", person_in_charge: suggestion.person_in_charge || "" },
    };
    setActiveMeeting({
      ...activeMeeting,
      items: [...activeMeeting.items, newItem],
    });
    setMissedTopics((topics) => topics.filter((_, i) => i !== index));
  };

  const handleAddAllDiscoveredTopics = () => {
    if (!activeMeeting || !missedTopics.length) return;
    const newItems: DiscussionItem[] = missedTopics.map((suggestion, idx) => ({
      id: `dp_${Date.now()}_${activeMeeting.items.length + idx}`,
      topic: suggestion.topic_title,
      evidence: suggestion.evidence_quote || "",
      discussion_point: suggestion.discussion_point || "Review and complete the discussion details.",
      action_suggestion: { action_plan: suggestion.action_plan || "", target_date: suggestion.indicative_delivery_date || "", person_in_charge: suggestion.person_in_charge || "" },
    }));
    setActiveMeeting({
      ...activeMeeting,
      items: [...activeMeeting.items, ...newItems],
    });
    setMissedTopics([]);
  };

  const handleDismissDiscoveredTopic = (index: number) => {
    setMissedTopics((topics) => topics.filter((_, i) => i !== index));
  };

  const handleCopyTranscript = async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTranscript(true);
      setTimeout(() => setCopiedTranscript(false), 2000);
    } catch {
      // ignore
    }
  };

  // Delete meeting
  const handleConfirmDelete = async () => {
    if (!activeMeeting) return;
    setIsDeleting(true);
    try {
      if (onDeleteMeeting) {
        await onDeleteMeeting(activeMeeting.id);
      }
      setShowDeleteModal(false);
    } catch (error: any) {
      alert(error.message || "Failed to delete meeting archive.");
    } finally {
      setIsDeleting(false);
    }
  };

  // Re-export Word
  const handleExportWord = async () => {
    if (!activeMeeting) return;
    setIsExporting(true);
    try {
      const metadata = {
        client_name: activeMeeting.title,
        date: activeMeeting.date,
        meeting_type: activeMeeting.meeting_type,
        location: activeMeeting.location,
        attendees_prime: activeMeeting.attendees_prime,
        attendees_external: activeMeeting.attendees_external
      };
      await exportWord(metadata, activeMeeting.items, (activeMeeting.action_items || []).map((action) => {
        const source = activeMeeting.items.find((item) => String(item.id) === String(action.discussion_point_id));
        return { ...action, discussion_point_title: source?.topic || "", discussion_point: source?.discussion_point || "" };
      }), activeMeeting.summary, "");
    } catch (e: any) {
      alert("Failed to export Word: " + e.message);
    } finally {
      setIsExporting(false);
    }
  };

  // Re-export PDF
  const handleExportPdf = async () => {
    if (!activeMeeting) return;
    setIsExporting(true);
    try {
      const metadata = {
        client_name: activeMeeting.title,
        date: activeMeeting.date,
        meeting_type: activeMeeting.meeting_type,
        location: activeMeeting.location,
        attendees_prime: activeMeeting.attendees_prime,
        attendees_external: activeMeeting.attendees_external
      };
      await exportPdf(metadata, activeMeeting.items, (activeMeeting.action_items || []).map((action) => {
        const source = activeMeeting.items.find((item) => String(item.id) === String(action.discussion_point_id));
        return { ...action, discussion_point_title: source?.topic || "", discussion_point: source?.discussion_point || "" };
      }), activeMeeting.summary, "");
    } catch (e: any) {
      alert("Failed to export PDF: " + e.message);
    } finally {
      setIsExporting(false);
    }
  };

  const archivedSummaryParts = (activeMeeting?.summary || "").split(/\r?\n\s*\r?\n/);

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-line">
        <div>
          <h1 className="text-2xl font-serif font-bold text-fg italic">
            Meetings Archives
          </h1>
          <p className="text-xs font-bold tracking-wider text-fg-muted uppercase mt-0.5">
            Structured records • In-Place Editing • Instant Re-Export
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
          {/* Workspace filters are only available in the hosted app. */}
          {!desktopMode && <>
          {/* Space Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Space</span>
            <select
              value={selectedMeetingSpace}
              onChange={(event) => {
                const spaceId = event.target.value;
                setSelectedMeetingSpace(spaceId);
                onSelectMeetingSpace?.(spaceId);
              }}
              className="border border-line bg-surface-panel py-1 px-2.5 min-w-[150px] max-w-[260px] text-xs font-normal normal-case tracking-normal text-left text-fg hover:border-line focus:outline-none focus:border-focus transition-colors cursor-pointer"
            >
              <option value="__all__">All spaces</option>
              <option value="__personal__">Personal List</option>
              {meetingSpaces.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name} — {space.teamName}
                </option>
              ))}
            </select>
          </div>
          </>}

          {/* Date Range Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">From</span>
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              className="border border-line bg-surface-panel py-1 px-2 text-xs font-normal normal-case tracking-normal text-fg hover:border-line focus:outline-none focus:border-focus transition-colors cursor-pointer"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">To</span>
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              className="border border-line bg-surface-panel py-1 px-2 text-xs font-normal normal-case tracking-normal text-fg hover:border-line focus:outline-none focus:border-focus transition-colors cursor-pointer"
            />
          </div>

          {(fromDate || toDate || selectedMeetingSpace !== "__all__") && (
            <button
              type="button"
              onClick={() => {
                setFromDate("");
                setToDate("");
                setSelectedMeetingSpace("__all__");
                onSelectMeetingSpace?.("__all__");
              }}
              className="px-2 py-1 text-[11px] font-medium text-fg-muted hover:text-fg transition-colors cursor-pointer"
              title="Reset all filters"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Master-Detail Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* LEFT MASTER PANE (4 cols) */}
        <div className="lg:col-span-4 space-y-3 bg-surface-panel border border-line rounded-none p-4 shadow-2xs">
          {/* Search Box */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-2.5 text-fg-muted" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filter archived meetings..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-surface-panel border border-line rounded-none focus:outline-none focus:border-focus"
            />
          </div>

          {/* Type Filter Pills */}
          <div className="flex items-center gap-1.5 pt-1">
            {(["All", "Internal", "External", "Archives"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTypeFilter(t);
                  if (t === "Archives") {
                    refreshInterruptedSessions();
                  }
                }}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-none transition-colors flex items-center gap-1 ${
                  typeFilter === t
                    ? "bg-action text-on-action"
                    : "bg-surface-panel text-fg-secondary hover:bg-surface-hover"
                }`}
              >
                {t === "Archives" && <Archive size={11} className={typeFilter === t ? "text-link" : "text-fg-muted"} />}
                <span>{t}</span>
                {t === "Archives" && interruptedItems.length > 0 && (
                  <span className={`text-[9px] font-bold px-1 py-0.2 rounded-none ${typeFilter === t ? "bg-warning-surface text-fg" : "bg-warning-surface text-warning-fg"}`}>
                    {interruptedItems.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Meeting Cards List */}
          <div className="space-y-2 pt-2 max-h-[720px] overflow-y-auto pr-1">
            {typeFilter === "Archives" ? (
              interruptedItems.length > 0 ? (
                interruptedItems.map((item) => {
                  const isSelected = activeInterruptedItem?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedInterruptedId(item.id)}
                      className={`block w-full p-3.5 rounded-none border text-left cursor-pointer transition-all ${
                        isSelected
                          ? "bg-surface-selected border-focus shadow-xs"
                          : "bg-surface-panel border-line hover:border-control-border hover:bg-surface-hover"
                      }`}
                    >
                      <span className="flex items-start justify-between gap-2 mb-1.5">
                        <span className="font-serif text-base lg:text-[17px] font-bold line-clamp-1 text-fg">
                          {item.title}
                        </span>
                        <span className="flex items-center gap-1 shrink-0 mt-0.5">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 border uppercase tracking-wider ${item.recordingState === "saved" ? "bg-info-surface text-info-fg border-info-border" : "bg-warning-surface text-warning-fg border-warning-border"}`}>
                            {item.recordingState !== "saved" && <AlertTriangle size={10} className="text-warning-fg" />} {item.recordingState === "saved" ? "Saved" : item.recordingState === "checkpoint" ? "Checkpoint" : "Interrupted"}
                          </span>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-none bg-surface-raised text-fg border border-line uppercase tracking-wider">
                            {item.mediaType}
                          </span>
                        </span>
                      </span>

                      <span className="flex items-center justify-between text-[11px] text-fg-muted">
                        <span className="flex items-center gap-1">
                          <Calendar size={11} className="text-fg-muted" />
                          <span>{item.date ? formatEchoDate(item.date) : "Recent Recording"}</span>
                        </span>
                        {item.durationSeconds > 0 ? (
                          <span className="flex items-center gap-1 text-[10px] text-fg-muted">
                            <Clock size={10} className="text-fg" />
                            <span>
                              {Math.floor(item.durationSeconds / 60)}m {item.durationSeconds % 60}s
                            </span>
                          </span>
                        ) : item.fileSize ? (
                          <span className="text-[10px] text-fg-muted">
                            {(item.fileSize / (1024 * 1024)).toFixed(1)} MB
                          </span>
                        ) : null}
                      </span>

                      <span className="mt-2 pt-2 border-t border-line flex items-center justify-between text-[10px] text-fg-muted">
                        <span>{item.noteCount > 0 ? `${item.noteCount} Notes captured` : item.recordingState === "saved" ? "Saved recording · not processed" : "Unprocessed recording"}</span>
                        <span className="flex items-center gap-2">
                          <span className="text-link font-semibold">{isSelected ? "Selected" : "View"}</span>
                        </span>
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="p-6 text-center text-xs text-fg-muted">
                  No saved or interrupted recordings found.
                </div>
              )
            ) : filteredList.length > 0 ? (
              filteredList.map((m) => {
                const isSelected = activeMeeting?.id === m.id;
                return (
                  <div
                    key={m.id}
                    onClick={() => onSelectMeeting(m.id)}
                    className={`p-3.5 rounded-none border text-left cursor-pointer transition-all ${
                      isSelected
                        ? "bg-surface-selected border-focus shadow-xs"
                        : "bg-surface-panel border-line hover:border-line hover:bg-surface-hover"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <h4 className={`font-serif text-base lg:text-[17px] font-bold italic line-clamp-1 ${isSelected ? "text-fg" : "text-fg"}`}>
                        {m.title}
                      </h4>
                      <div className="flex items-center gap-1 shrink-0 mt-0.5">
                        {desktopMode ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 bg-surface-raised text-fg-secondary border border-line uppercase tracking-wider">Local</span>
                        ) : m.is_confidential ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 bg-warning-surface text-warning-fg border border-warning-border uppercase tracking-wider">
                            <Lock size={10} className="text-warning-fg" /> Private
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 bg-info-surface text-fg border border-info-border uppercase tracking-wider">
                            <Users size={10} className="text-fg" /> Shared
                          </span>
                        )}
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-none bg-success-surface text-success-fg border border-success-border uppercase tracking-wider">
                          {m.meeting_type}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-fg-muted">
                      <div className="flex items-center gap-1">
                        <Calendar size={11} className="text-link" />
                        <span>{formatEchoDate(m.date)}</span>
                      </div>
                      {!desktopMode && m.clickup_space_name && (
                        <span className="text-[9px] px-1.5 py-0.5 bg-surface-raised text-fg font-medium border border-line truncate max-w-[130px]">
                          {m.clickup_space_name}
                        </span>
                      )}
                    </div>

                    {m.location && (
                      <div className="text-[10px] text-fg-muted truncate mt-1">
                        {m.location}
                      </div>
                    )}

                    <div className="mt-2 pt-2 border-t border-line flex items-center justify-between text-[10px] text-fg-muted">
                      <span>{m.items.length} Topics</span>
                      <div className="flex items-center gap-2">
                        <span className="text-link font-semibold">{isSelected ? "Editing" : "View"}</span>
                        {!desktopMode && <a
                          href={m.clickup_task_url || `https://app.clickup.com/t/${m.meeting_id || m.id}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex items-center gap-1 border border-link px-1.5 py-1 text-[9px] font-bold uppercase tracking-wide text-fg hover:border-warning-border hover:text-warning-fg"
                          title="Open this meeting archive in ClickUp"
                        >
                          <ExternalLink size={10} />
                          ClickUp
                        </a>}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-6 text-center text-xs text-fg-muted">
                No meetings match your filter.
              </div>
            )}
          </div>
        </div>

        {/* RIGHT DETAIL PANE (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          {typeFilter === "Archives" ? (
            activeInterruptedItem ? (
              <div className="bg-surface-panel border border-line rounded-none p-6 shadow-2xs space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-line">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-xs font-bold tracking-widest uppercase px-2 py-0.5 border flex items-center gap-1.5 ${activeInterruptedItem.recordingState === "saved" ? "bg-info-surface text-info-fg border-info-border" : "bg-warning-surface text-warning-fg border-warning-border"}`}>
                      {activeInterruptedItem.recordingState === "saved" ? <Archive size={12} /> : <AlertTriangle size={12} />}
                      {activeInterruptedItem.recordingState === "saved" ? "Saved Recording" : activeInterruptedItem.recordingState === "checkpoint" ? "Recording Checkpoint" : "Interrupted Meeting Record"}
                    </span>
                    <span className="text-[10px] text-fg-muted font-mono">
                      #{activeInterruptedItem.id.slice(-10)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Process into Minutes */}
                    <button
                      type="button"
                      onClick={() => {
                        if (activeInterruptedItem.kind === "indexeddb" && activeInterruptedItem.session) {
                          void handleProcessInterruptedSession(activeInterruptedItem.session);
                        } else if (activeInterruptedItem.fileName) {
                          void handleProcessLocalInterruptedFile(activeInterruptedItem.fileName);
                        }
                      }}
                      disabled={isProcessingInterrupted === activeInterruptedItem.id || (activeInterruptedItem.kind === "local_file" && activeInterruptedItem.recordingState !== "checkpoint" && activeInterruptedItem.conversionState !== "ready")}
                      className="btn-primary !py-1.5 !px-3.5 !text-xs flex items-center gap-1.5 shadow-xs rounded-none cursor-pointer"
                    >
                      <Sparkles size={13} className="text-link" />
                      <span>
                        {isProcessingInterrupted === activeInterruptedItem.id ? "Processing…" : "Process into Minutes Now"}
                      </span>
                    </button>

                    {/* Download Recording */}
                    <button
                      type="button"
                      onClick={() => {
                        if (activeInterruptedItem.kind === "indexeddb") {
                          void handleDownloadInterruptedSession(activeInterruptedItem.id);
                        } else if (activeInterruptedItem.fileName) {
                          handleDownloadLocalInterruptedFile(activeInterruptedItem.fileName);
                        }
                      }}
                      className="btn-outline !py-1.5 !px-3 !text-xs flex items-center gap-1.5 text-fg rounded-none cursor-pointer"
                      title="Download recorded file to disk"
                    >
                      <Download size={13} className="text-link" />
                      <span>Download</span>
                    </button>

                    {/* Discard / Delete */}
                    <button
                      type="button"
                      onClick={() => {
                        if (activeInterruptedItem.kind === "indexeddb") {
                          void handleDiscardInterruptedSession(activeInterruptedItem.id);
                        } else if (activeInterruptedItem.fileName) {
                          void handleDiscardLocalInterruptedFile(activeInterruptedItem.fileName);
                        }
                      }}
                      className="p-1.5 text-danger-fg hover:text-danger-fg hover:bg-danger-surface border border-danger-border transition-colors rounded-none cursor-pointer"
                      title="Delete recording"
                      aria-label="Delete recording"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {activeInterruptedItem.kind === "local_file" && activeInterruptedItem.recordingState !== "checkpoint" && activeInterruptedItem.conversionState !== "ready" && (
                  <div className={`space-y-2 border p-3 text-xs ${activeInterruptedItem.conversionState === "failed" ? "border-danger-border bg-danger-surface text-danger-fg" : "border-line bg-surface-raised text-fg-secondary"}`} role={activeInterruptedItem.conversionState === "failed" ? "alert" : "status"}>
                    {activeInterruptedItem.conversionState === "failed" ? (
                      <>
                        <p>Conversion failed. The original recording is still available. {activeInterruptedItem.conversionError}</p>
                        <button type="button" onClick={() => void controlConversions("retry", activeInterruptedItem.conversionJobId || activeInterruptedItem.fileName)} className="border border-line bg-surface-panel px-2 py-1 text-fg hover:border-link">Retry conversion</button>
                      </>
                    ) : (
                      <>
                        <p>{activeInterruptedItem.conversionState === "converting" ? `Converting recording: ${activeInterruptedItem.conversionProgress || 0}%` : "Waiting for recording conversion…"}</p>
                        <progress aria-label="Recording conversion progress" max={100} value={activeInterruptedItem.conversionState === "converting" ? activeInterruptedItem.conversionProgress : undefined} className="block h-2 w-full accent-link" />
                        <button type="button" onClick={() => void controlConversions(conversionPaused ? "resume" : "pause")} className="border border-line bg-surface-panel px-2 py-1 text-fg hover:border-link">{conversionPaused ? "Resume conversions" : activeInterruptedItem.conversionState === "converting" ? "Pause after this file" : "Pause conversions"}</button>
                      </>
                    )}
                  </div>
                )}

                {/* Metadata summary grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-surface-raised p-4 border border-line text-xs">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-fg-secondary mb-0.5">
                      Recorded Date
                    </label>
                    <p className="font-semibold text-fg">
                      {activeInterruptedItem.date ? formatEchoDate(activeInterruptedItem.date) : "Recent Session"}
                    </p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-fg-secondary mb-0.5">
                      Recorded Duration
                    </label>
                    <p className="font-semibold text-fg">
                      {activeInterruptedItem.durationSeconds > 0
                        ? `${Math.floor(activeInterruptedItem.durationSeconds / 60)} mins ${activeInterruptedItem.durationSeconds % 60} secs`
                        : activeInterruptedItem.fileSize
                        ? `${(activeInterruptedItem.fileSize / (1024 * 1024)).toFixed(2)} MB on disk`
                        : "Incomplete recording"}
                    </p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-fg-secondary mb-0.5">
                      Media Type
                    </label>
                    <p className="font-semibold text-fg uppercase tracking-wide">
                      {activeInterruptedItem.mediaType === "video" ? "Screen / Video + Audio" : "Audio Recording"}
                    </p>
                  </div>
                </div>

                {/* Storage Origin Info */}
                <div className="text-[11px] text-fg-secondary bg-surface-panel border border-line p-3">
                  <span className="font-bold text-fg">Storage Location: </span>
                  {activeInterruptedItem.kind === "indexeddb" ? (
                    <span>Browser storage & auto-saved locally</span>
                  ) : (
                    <span>Local disk recording ({activeInterruptedItem.fileName})</span>
                  )}
                </div>

                {/* Notes taken during interrupted session if available */}
                {activeInterruptedItem.session?.notes && activeInterruptedItem.session.notes.length > 0 && (
                  <div className="border border-line bg-surface-panel p-4 space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-fg">
                      Notes Captured During Meeting ({activeInterruptedItem.session.notes.length})
                    </h4>
                    <div className="space-y-1.5 max-h-60 overflow-y-auto">
                      {activeInterruptedItem.session.notes.map((n) => (
                        <div key={n.id} className="text-xs bg-surface-raised border border-line p-2 flex items-start gap-2">
                          <span className="font-mono text-[10px] font-bold text-fg bg-surface-raised px-1 py-0.5 shrink-0">
                            {n.timestamp}
                          </span>
                          <span className="text-fg">{n.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-surface-panel border border-line rounded-none p-12 text-center text-fg-muted text-xs">
                Select a saved or interrupted recording from the archives list on the left to review or process.
              </div>
            )
          ) : activeMeeting ? (
            <>
              {/* Meeting Header & Export Action Bar */}
              <div className="bg-surface-panel border border-line rounded-none p-5 shadow-2xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-line">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold tracking-widest uppercase text-fg">
                      Meeting Record
                    </span>
                    <span className="text-[10px] text-fg-muted font-mono">
                      #{activeMeeting.meeting_id || activeMeeting.id}
                    </span>
                    <button type="button" onClick={() => setShowArchiveDetails(true)} className="inline-flex h-6 w-6 items-center justify-center text-fg hover:bg-info-surface rounded-none cursor-pointer" title="Show archive details" aria-label="Show archive details">
                      <Info size={14} />
                    </button>
                  </div>

                  {/* Controls */}
                  <div className="flex flex-wrap items-center gap-2">
                    {canExport && <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowShareMenu((open) => !open)}
                        disabled={isExporting}
                        aria-haspopup="menu"
                        aria-expanded={showShareMenu}
                        className="btn-outline !py-1.5 !px-3 !text-xs flex items-center gap-1.5 text-fg rounded-none"
                      >
                        <Send size={13} className="text-link" />
                        <span>{isExporting ? "Working…" : "Share"}</span>
                        <ChevronDown size={13} className="ml-0.5" />
                      </button>
                      {showShareMenu && !isExporting && <div role="menu" className="absolute right-0 top-full z-20 mt-1 min-w-[180px] border border-link bg-surface-panel p-1 shadow-lg">
                        <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-fg-muted">Share</div>
                        <button type="button" role="menuitem" onClick={() => { setShowShareMenu(false); setShowEmailModal(true); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-fg hover:bg-info-surface cursor-pointer"><Send size={13} className="text-link" /> Email via Outlook</button>
                        <div className="my-1 border-t border-line" />
                        <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-fg-muted">Export</div>
                        <button type="button" role="menuitem" onClick={() => { setShowShareMenu(false); void handleExportWord(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-fg hover:bg-info-surface cursor-pointer"><FileText size={13} className="text-link" /> Word (.docx)</button>
                        <button type="button" role="menuitem" onClick={() => { setShowShareMenu(false); void handleExportPdf(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-fg hover:bg-info-surface cursor-pointer"><Download size={13} className="text-link" /> PDF (.pdf)</button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => { setShowShareMenu(false); handleExportRecording(); }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-fg hover:bg-info-surface cursor-pointer"
                        >
                          {recordingType === "video" ? (
                            <Video size={13} className="text-link" />
                          ) : (
                            <Mic size={13} className="text-link" />
                          )}
                          <span>{recordingType === "video" ? `Export Video (.${recordingFormat})` : `Export Audio (.${recordingFormat})`}</span>
                        </button>
                      </div>}
                    </div>}

                    {matchedRecording && (
                      <button
                        type="button"
                        onClick={handleDownloadMatchedRecording}
                        className="btn-outline !py-1.5 !px-3 !text-xs flex items-center gap-1.5 text-fg bg-warning-surface hover:bg-warning-surface border-warning-border rounded-none cursor-pointer"
                        title={`Download recorded file: ${matchedRecording.name}`}
                      >
                        {matchedRecording.name.endsWith(".mp4") || matchedRecording.name.endsWith(".webm") ? (
                          <Video size={13} className="text-link" />
                        ) : (
                          <Mic size={13} className="text-link" />
                        )}
                        <span>{matchedRecording.name.endsWith(".mp4") || matchedRecording.name.endsWith(".webm") ? "Save Video" : "Save Audio"}</span>
                      </button>
                    )}

                    {!desktopMode && <button
                      type="button"
                      onClick={() => setShowMoveModal(true)}
                      className="btn-outline !py-1.5 !px-3 !text-xs flex items-center gap-1.5 text-fg rounded-none cursor-pointer"
                      title="Move meeting archive to another ClickUp list"
                    >
                      <FolderInput size={13} className="text-link" />
                      <span>Move</span>
                    </button>}

                    <button
                      type="button"
                      onClick={handleSaveChanges}
                      className="btn-primary !py-1.5 !px-4 !text-xs flex items-center gap-1.5 shadow-xs rounded-none"
                    >
                      <Save size={13} />
                      <span>Save Changes</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowDeleteModal(true)}
                      className="p-1.5 text-danger-fg hover:text-danger-fg hover:bg-danger-surface border border-danger-border transition-colors rounded-none"
                      title="Delete meeting archive"
                      aria-label="Delete meeting archive"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {saveSuccessMsg && (
                  <div className="p-2.5 bg-success-surface text-success-fg border border-success-border rounded-none text-xs flex items-center gap-2 animate-in fade-in">
                    <CheckCircle size={14} className="text-success-fg" />
                    <span>Meeting record updated and saved to archives.</span>
                  </div>
                )}

                {/* Details Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                  {/* Title */}
                  <div className="lg:col-span-2">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-fg-muted mb-1">
                      Meeting Name
                    </label>
                    <input
                      type="text"
                      value={activeMeeting.title}
                      onChange={(e) => setActiveMeeting({ ...activeMeeting, title: e.target.value })}
                      className="w-full font-serif font-bold text-base text-fg bg-surface-panel border border-line rounded-none px-2.5 py-1.5 focus:outline-none focus:border-focus focus:bg-surface-panel"
                    />
                  </div>

                  {/* Date */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-fg-muted mb-1">
                      Meeting Date
                    </label>
                    <DatePickerInput
                      value={activeMeeting.date}
                      onChange={(val) => setActiveMeeting({ ...activeMeeting, date: val })}
                    />
                  </div>

                  {/* Meeting Type */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-fg-muted mb-1">
                      Meeting Type
                    </label>
                    <div className="flex gap-2">
                      {(["Internal", "External", "Team"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setActiveMeeting({ ...activeMeeting, meeting_type: t })}
                          className={`flex-1 py-1.5 rounded-none font-semibold text-xs transition-colors ${
                            activeMeeting.meeting_type === t
                              ? "bg-action text-on-action"
                              : "bg-surface-panel text-fg-secondary hover:bg-surface-hover"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Start Time (Shown, not editable) */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-fg-muted mb-1">
                      Start Time
                    </label>
                    <div className="w-full bg-surface-panel border border-line rounded-none px-2.5 py-1.5 text-xs text-fg font-medium flex items-center justify-between">
                      <span>{formatDisplayTime(activeMeeting.start_time)}</span>
                      <Clock size={13} className="text-fg-muted" />
                    </div>
                  </div>

                  {/* End Time (Shown, not editable) */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-fg-muted mb-1">
                      End Time
                    </label>
                    <div className="w-full bg-surface-panel border border-line rounded-none px-2.5 py-1.5 text-xs text-fg font-medium flex items-center justify-between">
                      <span>{formatDisplayTime(activeMeeting.end_time)}</span>
                      <Clock size={13} className="text-fg-muted" />
                    </div>
                  </div>

                  {/* Location / Venue */}
                  <div className="lg:col-span-2">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-fg-muted mb-1">
                      Location / Venue
                    </label>
                    <select
                      value={isCustomVenue ? "Other / Custom..." : activeMeeting.location}
                      onChange={(e) => {
                        if (e.target.value === "Other / Custom...") {
                          setIsCustomVenue(true);
                        } else {
                          setIsCustomVenue(false);
                          setActiveMeeting({ ...activeMeeting, location: e.target.value });
                        }
                      }}
                      className="w-full bg-surface-panel border border-line rounded-none px-2.5 py-1.5 text-xs text-fg focus:outline-none focus:border-focus"
                    >
                      {VENUE_OPTIONS.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>

                    {isCustomVenue && (
                      <input
                        type="text"
                        value={activeMeeting.location}
                        onChange={(e) => setActiveMeeting({ ...activeMeeting, location: e.target.value })}
                        placeholder="Enter custom venue location..."
                        className="w-full mt-1.5 bg-surface-panel border border-line rounded-none px-2.5 py-1.5 text-xs text-fg focus:outline-none focus:border-focus"
                      />
                    )}
                  </div>

                  {/* Meeting Duration (Shown, not editable) */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-fg-muted mb-1">
                      Meeting Duration
                    </label>
                    <div className="w-full bg-surface-panel border border-line rounded-none px-2.5 py-1.5 text-xs text-fg font-medium flex items-center justify-between">
                      <span>{getMeetingDurationMinutes(activeMeeting)}</span>
                      <span className="text-xs text-fg-muted font-medium">mins</span>
                    </div>
                  </div>
                </div>

                {/* Attendees Rows */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-line">
                  {/* Team Attendees */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-fg mb-1">
                      Team Attendees
                    </label>
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {(activeMeeting.attendees_prime || []).map((att) => (
                        <span key={att} className="inline-flex items-center gap-1 text-[11px] bg-info-surface text-fg px-2 py-0.5 rounded-none font-medium">
                          {att}
                          <button onClick={() => handleRemovePrimeAttendee(att)} className="hover:text-danger-fg">
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={primeInput}
                        onChange={(e) => setPrimeInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddPrimeAttendee();
                          }
                        }}
                        placeholder="Add team attendee..."
                        className="flex-1 text-xs bg-surface-panel border border-line rounded-none px-2 py-1 focus:outline-none focus:border-focus"
                      />
                      <button onClick={handleAddPrimeAttendee} className="btn-outline !py-1 !px-2.5 !text-xs rounded-none">
                        Add
                      </button>
                    </div>
                  </div>

                  {/* External Attendees */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-link mb-1">
                      External Attendees
                    </label>
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {(activeMeeting.attendees_external || []).map((att) => (
                        <span key={att} className="inline-flex items-center gap-1 text-[11px] bg-warning-surface text-fg px-2 py-0.5 rounded-none font-medium">
                          {att}
                          <button onClick={() => handleRemoveExternalAttendee(att)} className="hover:text-danger-fg">
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={externalInput}
                        onChange={(e) => setExternalInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddExternalAttendee();
                          }
                        }}
                        placeholder="Add external attendee..."
                        className="flex-1 text-xs bg-surface-panel border border-line rounded-none px-2 py-1 focus:outline-none focus:border-focus"
                      />
                      <button onClick={handleAddExternalAttendee} className="btn-outline !py-1 !px-2.5 !text-xs rounded-none">
                        Add
                      </button>
                    </div>
                  </div>
                </div>

              </div>

              <MeetingWorkspaceTabs value={detailTab} onChange={setDetailTab} compact />

              {detailTab === "summary" ? (
                <MeetingSummaryEditor
                  summary={archivedSummaryParts[0] || ""}
                  bottomLine={archivedSummaryParts.slice(1).join("\n\n")}
                  onChange={(summary, bottomLine) => setActiveMeeting({ ...activeMeeting, summary: [summary.trim(), bottomLine.trim()].filter(Boolean).join("\n\n") })}
                  notes={activeMeeting.meeting_notes || ""}
                  transcript={activeMeeting.transcript || ""}
                />
              ) : detailTab === "transcript" ? (
                /* Transcript Tab */
                <div className="bg-surface-panel border border-line rounded-none p-5 shadow-2xs space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-line">
                    <div>
                      <h3 className="font-serif font-bold text-lg text-fg italic">
                        Full Raw Transcript
                      </h3>
                      <p className="text-[11px] text-fg-muted mt-0.5">
                        Spoken dialogue and speaker turns captured during the recording session.
                      </p>
                    </div>
                    {activeMeeting.transcript && (
                      <button
                        type="button"
                        onClick={() => handleCopyTranscript(activeMeeting.transcript || "")}
                        className="btn-outline !py-1 !px-2.5 !text-[11px] rounded-none flex items-center gap-1.5 cursor-pointer"
                      >
                        {copiedTranscript ? <Check size={12} className="text-success-fg" /> : <Copy size={12} />}
                        <span>{copiedTranscript ? "Copied" : "Copy Transcript"}</span>
                      </button>
                    )}
                  </div>

                  {activeMeeting.transcript?.trim() ? (
                    <AutoResizeTextarea
                      value={activeMeeting.transcript || ""}
                      onChange={(e) => setActiveMeeting({ ...activeMeeting, transcript: e.target.value })}
                      placeholder="Full raw transcript text..."
                      className="w-full text-xs font-mono text-fg bg-surface-panel border border-line rounded-none p-3.5 focus:outline-none focus:border-focus leading-relaxed min-h-[320px]"
                      rows={14}
                    />
                  ) : (
                    <div className="border border-dashed border-line bg-surface-panel p-8 text-center">
                      <FileText size={22} className="mx-auto text-fg" />
                      <p className="mt-2 text-sm font-medium text-fg-secondary">No transcript attached to this meeting</p>
                      <p className="mt-1 text-xs text-fg-muted">Audio recordings or uploaded transcripts appear here.</p>
                    </div>
                  )}
                </div>
              ) : detailTab === "notes" ? (
                /* Meeting Notes Tab */
                <div className="bg-surface-panel border border-line rounded-none p-5 shadow-2xs space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-line">
                    <div>
                      <h3 className="font-serif font-bold text-lg text-fg italic">
                        Meeting Notes
                      </h3>
                      <p className="text-[11px] text-fg-muted mt-0.5">
                        Notes captured in the workspace during the meeting session.
                      </p>
                    </div>
                  </div>

                  {/* Timestamped Notes List Preview */}
                  {(() => {
                    const rawNotes = activeMeeting.meeting_notes || "";
                    const lines = rawNotes.split("\n").map((l) => l.trim()).filter(Boolean);
                    if (lines.length === 0) {
                      return (
                        <div className="border border-dashed border-line bg-surface-panel p-8 text-center">
                          <MessageCircle size={22} className="mx-auto text-fg" />
                          <p className="mt-2 text-sm font-medium text-fg-secondary">No meeting notes recorded</p>
                          <p className="mt-1 text-xs text-fg-muted">Notes captured in the workspace stay linked to the meeting time.</p>
                        </div>
                      );
                    }
                    return (
                      <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                        {lines.map((line, idx) => {
                          const match = line.match(/^(\[\d{2}:\d{2}(?::\d{2})?\])\s*(.*)$/);
                          const noteText = match ? match[2] : line;
                          return (
                            <div key={idx} className="flex items-start gap-2.5 border border-line bg-surface-panel p-3 shadow-2xs">
                              <span className="text-xs text-fg flex-1 leading-relaxed break-words">
                                {noteText}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              ) : detailTab === "actions" ? (
                <div className="bg-surface-panel border border-line rounded-none p-5 shadow-2xs space-y-3">
                  <h3 className="font-serif font-bold text-lg text-fg italic">Action Items</h3>
                  <MeetingActionItemsTable
                    items={(activeMeeting.action_items || []).map((action) => {
                      const source = activeMeeting.items.find((item) => String(item.id) === String(action.discussion_point_id));
                      return {
                        id: String(action.id),
                        discussionPointId: String(action.discussion_point_id),
                        discussionPointTitle: source?.topic || "Discussion removed",
                        discussionPoint: source?.discussion_point || "",
                        actionPlan: action.action_plan,
                        targetDate: action.target_date,
                        personInCharge: action.person_in_charge,
                        assigneeId: action.assignee_id,
                        assigneeIds: action.assignee_ids || (action.assignee_id ? [action.assignee_id] : []),
                      };
                    })}
                    members={meetingAssignees}
                    onChange={(id, field, value, assigneeIds) => {
                      handleUpdateAction(id, field, value, assigneeIds);
                    }}
                    renderAction={(row) => {
                      const index = (activeMeeting.action_items || []).findIndex((item) => String(item.id) === row.id);
                      const item = (activeMeeting.action_items || [])[index];
                      if (!item) return null;
                      const source = activeMeeting.items.find((discussion) => String(discussion.id) === String(item.discussion_point_id));
                      if (desktopMode) return null;
                      return item.clickUpTaskId ? (
                        <button type="button" onClick={() => onNavigateToTasks && onNavigateToTasks(item.clickUpTaskId!)} className="mt-2 flex items-center gap-1.5 border border-success-border bg-success-surface px-2.5 py-1 text-[11px] font-bold text-success-fg hover:bg-success-surface" title="Already added to ClickUp. Click to view in Tasks portal">
                          <CheckCircle size={13} className="text-success-fg" /><span>Added to Tasks</span>
                        </button>
                      ) : (
                        <button type="button" onClick={() => setQuickAddTaskData({
                          isOpen: true,
                          data: {
                            name: item.action_plan || source?.topic || `Action ${index + 1}`,
                            description: source?.discussion_point || "",
                            topic: source?.topic || "",
                            evidence: source?.evidence || "",
                            meetingTitle: activeMeeting.title || "Meeting Archive",
                            meetingDate: activeMeeting.date,
                            dueDate: item.target_date || "",
                            priority: "normal",
                            assigneeName: item.person_in_charge || "",
                            assigneeId: item.assignee_id || "",
                            assigneeIds: item.assignee_ids || (item.assignee_id ? [item.assignee_id] : []),
                            discussionPointId: String(item.discussion_point_id),
                            existingTaskId: item.clickUpTaskId,
                            existingTaskUrl: item.clickUpUrl,
                          },
                          actionIndex: index,
                        })} className="mt-2 flex items-center gap-1.5 border border-link bg-surface-panel px-2.5 py-1 text-[11px] font-bold text-fg transition-colors hover:border-link hover:bg-info-surface">
                          <CheckSquare size={13} className="text-link" /><span>Add to Tasks</span>
                        </button>
                      );
                    }}
                  />
                </div>
              ) : (
                /* Discussion Points Matrix Tab */
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-serif font-bold text-lg text-fg italic">
                      Discussion Points Matrix
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleAddNewItem}
                        className="btn-outline !py-1.5 !px-3 !text-xs flex items-center gap-1 text-fg hover:bg-action-hover hover:text-fg transition-all rounded-none cursor-pointer"
                      >
                        <Plus size={13} /> Add Topic
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!activeMeeting.transcript?.trim()) {
                            alert("No transcript found for this meeting archive to discover topics from.");
                            return;
                          }
                          setShowDiscoverTopicsModal(true);
                          if (missedTopics.length === 0) {
                            void handleDiscoverTopics("");
                          }
                        }}
                        className="btn-primary !py-1.5 !px-3 !text-xs flex items-center gap-1.5 rounded-none cursor-pointer"
                      >
                        <Sparkles size={13} className="text-link" />
                        <span>Discover Topics</span>
                      </button>
                    </div>
                  </div>

                {activeMeeting.items.length === 0 ? (
                  <div className="border border-dashed border-line bg-surface-panel p-8 text-center">
                    <p className="text-sm font-medium text-fg-secondary">No discussion topics recorded yet</p>
                  </div>
                ) : (
                  activeMeeting.items.map((item, idx) => (
                    <MeetingDiscussionCard
                      key={item.id || idx}
                      title={item.topic}
                      discussionPoint={item.discussion_point}
                      evidenceQuote={item.evidence || ""}
                      actionCount={(activeMeeting.action_items || []).filter((action) => String(action.discussion_point_id) === String(item.id)).length}
                      onAddAction={() => handleAddAction(item)}
                      onTitleChange={(value) => handleUpdateItem(idx, "topic", value)}
                      onDiscussionPointChange={(value) => handleUpdateItem(idx, "discussion_point", value)}
                    >
                      <div className="flex items-center justify-between gap-3 border-t border-line pt-2">
                        <span className="text-[10px] font-mono text-fg-muted">Topic #{idx + 1}</span>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <button type="button" onClick={() => handleMoveItem(idx, "up")} disabled={idx === 0} title="Move Topic Up" className="border border-line p-1 text-fg-muted hover:text-fg ">
                            <ChevronUp size={15} />
                          </button>
                          <button type="button" onClick={() => handleMoveItem(idx, "down")} disabled={idx === activeMeeting.items.length - 1} title="Move Topic Down" className="border border-line p-1 text-fg-muted hover:text-fg ">
                            <ChevronDown size={15} />
                          </button>
                          <button type="button" onClick={() => handleRemoveItem(idx)} title="Remove Topic" className="border border-line p-1 text-fg-muted transition-colors hover:border-danger-border hover:text-danger-fg">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </MeetingDiscussionCard>
                  ))
                )}
              </div>
              )}
            </>
          ) : (
            <div className="bg-surface-panel border border-line rounded-none p-12 text-center text-fg-muted text-xs">
              Select a meeting from the archive list on the left to view details and discussion points.
            </div>
          )}
        </div>

      </div>

      {showArchiveDetails && activeMeeting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4" role="dialog" aria-modal="true" aria-labelledby="archive-details-title">
          <div className="w-full max-w-sm border border-line bg-surface-panel p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-line pb-3">
              <div><h2 id="archive-details-title" className="text-sm font-bold uppercase tracking-[0.14em] text-fg">Meeting Archive Details</h2><p className="mt-1 text-[11px] text-fg-muted">Reference information only.</p></div>
              <button type="button" onClick={() => setShowArchiveDetails(false)} aria-label="Close archive details" className="text-fg-muted hover:text-fg"><X size={16} /></button>
            </div>
            <dl className="mt-4 space-y-3 text-xs">
              {!desktopMode && <div><dt className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Space</dt><dd className="mt-1 text-fg">{activeMeeting.clickup_space_name || "Not recorded"}</dd></div>}
              {!desktopMode && <div><dt className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">List</dt><dd className="mt-1 text-fg">{activeMeeting.clickup_list_name || "Not recorded"}</dd></div>}
              <div><dt className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Status</dt><dd className="mt-1 text-fg">{desktopMode ? "Saved locally" : activeMeeting.archive_status || "Completed On Time"}</dd></div>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-line">
                <div><dt className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Start Time</dt><dd className="mt-1 text-fg font-medium">{formatDisplayTime(activeMeeting.start_time)}</dd></div>
                <div><dt className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">End Time</dt><dd className="mt-1 text-fg font-medium">{formatDisplayTime(activeMeeting.end_time)}</dd></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><dt className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Meeting Duration</dt><dd className="mt-1 text-fg font-medium">{getMeetingDurationMinutes(activeMeeting)} mins</dd></div>
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Total Meeting Cost</dt>
                  <dd className="mt-1 text-base font-serif font-bold text-fg">
                    ₱{((getMeetingDurationMinutes(activeMeeting) / 60) * TOTAL_AI_PHP_PER_HOUR).toFixed(2)}
                  </dd>
                </div>
              </div>
            </dl>
          </div>
        </div>
      )}

      <EmailMeetingModal
        isOpen={showEmailModal && !!activeMeeting}
        onClose={() => setShowEmailModal(false)}
        fromEmail={userEmail}
        meeting={activeMeeting ? {
          title: activeMeeting.title,
          date: activeMeeting.date,
          metadata: {
            client_name: activeMeeting.title,
            date: activeMeeting.date,
            meeting_type: activeMeeting.meeting_type,
            location: activeMeeting.location,
            attendees_prime: activeMeeting.attendees_prime,
            attendees_external: activeMeeting.attendees_external,
          },
          items: activeMeeting.items,
          action_items: activeMeeting.action_items || [],
          summary: activeMeeting.summary,
        } : { metadata: {}, items: [], action_items: [] }}
      />

      {/* Delete Confirmation Modal */}
      {showDeleteModal && activeMeeting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
          <div className="w-full max-w-md border border-line bg-surface-panel p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2 text-danger-fg">
                <Trash2 size={18} />
                <h2 id="delete-modal-title" className="text-sm font-bold uppercase tracking-wider">
                  Delete Meeting Archive
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                className="text-fg-muted hover:text-fg"
                aria-label="Close modal"
              >
                <X size={16} />
              </button>
            </div>

            <div className="text-xs text-fg-secondary space-y-2">
              <p>
                Are you sure you want to permanently delete this meeting archive?
              </p>
              <div className="p-3 bg-surface-raised border border-line">
                <div className="font-serif font-bold text-sm text-fg line-clamp-1">{activeMeeting.title}</div>
                <div className="text-[11px] text-fg-muted mt-0.5">{formatEchoDate(activeMeeting.date)} • {activeMeeting.items.length} discussion topics</div>
              </div>
              <p className="text-[11px] text-fg-muted">
                {desktopMode ? "This will permanently delete the local meeting record. This action cannot be undone." : "This will remove the meeting record from ClickUp and the archive database. This action cannot be undone."}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                className="btn-outline !py-1.5 !px-3 !text-xs rounded-none"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="bg-danger-action hover:bg-danger-action-hover text-on-action font-semibold px-4 py-1.5 text-xs rounded-none shadow-xs flex items-center gap-1.5 "
              >
                {isDeleting && <Loader2 size={12} className="animate-spin" />}
                <span>{isDeleting ? "Deleting..." : "Delete Archive"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move Meeting Archive Modal */}
        {!desktopMode && activeMeeting && (
        <MoveMeetingModal
          isOpen={showMoveModal}
          onClose={() => setShowMoveModal(false)}
          meeting={activeMeeting}
          spaces={meetingSpaces}
          onMeetingMoved={async (updated) => {
            setActiveMeeting(updated);
            if (onMoveMeeting) {
              await onMoveMeeting(updated);
            } else {
              await onUpdateMeeting(updated);
            }
          }}
        />
      )}

      {/* Quick Add Task to ClickUp Modal */}
      {!desktopMode && <QuickAddTaskModal
        isOpen={quickAddTaskData.isOpen}
        onClose={() => setQuickAddTaskData({ isOpen: false, data: {} })}
        initialData={quickAddTaskData.data}
        onTaskCreated={(created) => {
          if (activeMeeting && quickAddTaskData.actionIndex !== undefined) {
            const idx = quickAddTaskData.actionIndex;
            const updatedActions = [...(activeMeeting.action_items || [])];
            if (updatedActions[idx]) {
              updatedActions[idx] = {
                ...updatedActions[idx],
                clickUpTaskId: created.id,
                clickUpUrl: created.url,
              };
              const updatedMeeting = { ...activeMeeting, action_items: updatedActions };
              setActiveMeeting(updatedMeeting);
              onUpdateMeeting(updatedMeeting);
            }
          }
        }}
        onOpenInTasks={(taskId) => {
          if (onNavigateToTasks) onNavigateToTasks(taskId);
        }}
      />}

      {/* Discover & Search Topics Modal */}
      {activeMeeting && (
        <DiscoverTopicsModal
          isOpen={showDiscoverTopicsModal}
          onClose={() => setShowDiscoverTopicsModal(false)}
          missedTopics={missedTopics}
          isDiscoveringTopics={isDiscoveringTopics}
          autoDiscoverEnabled={autoDiscoverEnabled}
          onToggleAutoDiscover={() => setAutoDiscoverEnabled(!autoDiscoverEnabled)}
          topicQuery={topicQuery}
          onTopicQueryChange={setTopicQuery}
          onDiscoverTopics={handleDiscoverTopics}
          onAddTopic={handleAddDiscoveredTopic}
          onAddAllTopics={handleAddAllDiscoveredTopics}
          onDismissTopic={handleDismissDiscoveredTopic}
          transcript={activeMeeting.transcript || ""}
        />
      )}
    </div>
  );
}
