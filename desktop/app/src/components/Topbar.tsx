"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Search, 
  X, 
  Calendar, 
  CalendarPlus,
  FileText, 
  ArrowRight, 
  Mic, 
  LayoutDashboard,
  FolderKanban,
  NotebookTabs,
  RefreshCw,
  Blocks,
  CloudDownload,
  ArrowLeft,
  MessageSquarePlus,
} from "lucide-react";
import { ArchivedMeeting } from "@/features/meetings/types/meeting";
import { formatEchoDate } from "@/lib/dateUtils";

interface TopbarProps {
  meetings: ArchivedMeeting[];
  onOpenUniversalEcho: () => void;
  onOpenSearch?: () => void;
  onOpenUpdates?: () => void;
  onSelectMeeting: (meetingId: string) => void;
  onOpenStudio: () => void;
  onGoToNotetaker: () => void;
  showNewMeeting?: boolean;
  onNavigateToPage?: (page: "dashboard" | "project" | "business-analysis" | "meetings" | "notebook" | "minutes" | "settings") => void;
  allowedPages?: Array<"dashboard" | "project" | "business-analysis" | "meetings" | "notebook" | "minutes" | "settings">;
  isAdmin?: boolean;
  askEchoEnabled?: boolean;
  allowedFeatures?: string[];
  studioRecording?: {
    active?: boolean;
    isMinimized: boolean;
    elapsedSeconds: number;
    isPaused?: boolean;
    onRestore: () => void;
  };
}

type TopbarMenuAction = { label: string; shortcut?: string; disabled?: boolean; action?: () => void };

export function Topbar({
  meetings,
  onOpenUniversalEcho,
  onOpenSearch,
  onOpenUpdates,
  onSelectMeeting,
  onOpenStudio,
  onGoToNotetaker,
  showNewMeeting = false,
  onNavigateToPage,
  allowedPages,
  isAdmin,
  askEchoEnabled = false,
  allowedFeatures,
  studioRecording,
}: TopbarProps) {
  const formatMeetingClock = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remaining = seconds % 60;
    return [hours, minutes, remaining].map((value) => String(value).padStart(2, "0")).join(":");
  };
  const [searchQuery, setSearchQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<{ status: string; uploaded?: number; downloaded?: number; deleted?: number; syncedAt?: string | null; error?: string | null }>({ status: "idle" });
  const [manualSyncing, setManualSyncing] = useState(false);
  const [syncDetailsOpen, setSyncDetailsOpen] = useState(false);
  const [hasDesktopSync, setHasDesktopSync] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const menus: Array<{ label: string; actions: TopbarMenuAction[] }> = [
    { label: "File", actions: [
      { label: "New meeting", shortcut: "Ctrl+N", action: onGoToNotetaker },
      { label: "Sync workspace", action: () => void runManualSync() },
      { label: "Check for updatesâ€¦", action: onOpenUpdates },
    ] },
    { label: "Edit", actions: [
      { label: "Undo", shortcut: "Ctrl+Z", disabled: true },
      { label: "Redo", shortcut: "Ctrl+Y", disabled: true },
      { label: "Find", shortcut: "Ctrl+F", action: () => inputRef.current?.focus() },
    ] },
    { label: "Selection", actions: [{ label: "Select All", shortcut: "Ctrl+A", disabled: true }] },
    { label: "View", actions: [
      { label: "Dashboard", action: () => onNavigateToPage?.("dashboard") },
      { label: "IT Projects", action: () => onNavigateToPage?.("business-analysis") },
      { label: "Meetings", action: () => onNavigateToPage?.("meetings") },
      { label: "Notebook", action: () => onNavigateToPage?.("notebook") },
      { label: "Notetaker", action: () => onNavigateToPage?.("minutes") },
      { label: "Settings", action: () => onNavigateToPage?.("settings") },
    ] },
    { label: "Go", actions: [
      { label: "Go to Dashboard", action: () => onNavigateToPage?.("dashboard") },
      { label: "Go to Meetings", action: () => onNavigateToPage?.("meetings") },
      { label: "Search Workspaceâ€¦", shortcut: "Ctrl+P", action: () => { setIsOpen(true); requestAnimationFrame(() => inputRef.current?.focus()); } },
    ] },
    { label: "Run", actions: [{ label: "No run configurations", disabled: true }] },
    { label: "Terminal", actions: [{ label: "Use your system terminal", disabled: true }] },
    { label: "Help", actions: [
      { label: "Check for updatesâ€¦", action: onOpenUpdates },
      { label: "About Mosaic", disabled: true },
    ] },
  ];

  useEffect(() => {
    if (!openMenu) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-app-menu]")) setOpenMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpenMenu(null); };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenu]);

  useEffect(() => {
    const desktop = (window as Window & { mosaicDesktop?: { getWorkspaceSettings?: () => Promise<{ sync: typeof syncStatus }>; onSyncStatus?: (callback: (value: typeof syncStatus) => void) => () => void } }).mosaicDesktop;
    if (!desktop?.getWorkspaceSettings) return;
    setHasDesktopSync(true);
    void desktop.getWorkspaceSettings().then((settings) => setSyncStatus(settings.sync)).catch(() => {});
    return desktop.onSyncStatus?.(setSyncStatus);
  }, []);

  const runManualSync = async () => {
    const desktop = (window as Window & { mosaicDesktop?: { syncWorkspaceNow?: () => Promise<typeof syncStatus> } }).mosaicDesktop;
    if (!desktop?.syncWorkspaceNow || manualSyncing) return;
    setManualSyncing(true);
    setSyncStatus((current) => ({ ...current, status: "syncing", error: null }));
    setSyncDetailsOpen(true);
    try {
      setSyncStatus(await desktop.syncWorkspaceNow());
    } catch (error) {
      setSyncStatus((current) => ({ ...current, status: "failed", error: error instanceof Error ? error.message : "Sync failed." }));
    } finally {
      setManualSyncing(false);
    }
  };

  // Keyboard shortcut Ctrl+K / Cmd+K to focus search
  useEffect(() => {
    const openFromActivityBar = () => {
      setIsOpen(true);
      onOpenSearch?.();
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener("mosaic-open-search", openFromActivityBar);
    return () => window.removeEventListener("mosaic-open-search", openFromActivityBar);
  }, [onOpenSearch]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "p")) {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
        onOpenSearch?.();
      }
      if (e.key === "Escape") {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenSearch]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const query = searchQuery.trim().toLowerCase();

  // 1. Navigation Pages
  const APP_PAGES: Array<{ id: "dashboard" | "project" | "meetings" | "notebook" | "minutes" | "settings"; name: string; description: string; icon: any }> = [
    { id: "dashboard", name: "Dashboard", description: "Executive overview & meeting metrics", icon: LayoutDashboard },
    { id: "project", name: "Project", description: "Focused project workspace", icon: FolderKanban },
    { id: "meetings", name: "Meetings Archives", description: "Review and edit meeting minutes", icon: Calendar },
    { id: "notebook", name: "Notebook", description: "Daily logs & team completeness", icon: NotebookTabs },
    { id: "minutes", name: "Notetaker Studio", description: "Transcribe audio & synthesize notes", icon: Mic },
    { id: "settings", name: "Settings", description: "Workspace files and AI connections", icon: Blocks },
  ];

  const matchedPages = query
    ? APP_PAGES.filter((p) => {
        if (!isAdmin && allowedPages && allowedPages.length > 0 && !allowedPages.includes(p.id as any) && !(p.id === "project" && allowedPages.includes("business-analysis"))) return false;
        return (
          p.name.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query) ||
          p.id.includes(query)
        );
      })
    : [];

  // 2. Meetings
  const canAccessMeetings = isAdmin || !allowedPages || allowedPages.includes("meetings");
  const matchedMeetings = query && canAccessMeetings
    ? meetings.filter(
        (m) =>
          m.title.toLowerCase().includes(query) ||
          m.location.toLowerCase().includes(query) ||
          m.summary.toLowerCase().includes(query)
      ).slice(0, 5)
    : [];

  // 3. Discussion Topics & Action Items
  const matchedTopics: { meetingId: string; meetingTitle: string; topic: string; action: string }[] = [];
  if (query) {
    meetings.forEach((m) => {
      m.items.forEach((item) => {
        if (
          item.topic.toLowerCase().includes(query) ||
          item.discussion_point.toLowerCase().includes(query) ||
          (item.action_plan || "").toLowerCase().includes(query)
        ) {
          if (matchedTopics.length < 5) {
            matchedTopics.push({
              meetingId: m.id,
              meetingTitle: m.title,
              topic: item.topic,
              action: item.action_plan || ""
            });
          }
        }
      });
    });
  }

  const hasResults =
    matchedPages.length > 0 ||
    matchedMeetings.length > 0 ||
    matchedTopics.length > 0;

  return (
    <header className="mosaic-topbar sticky top-0 z-30 h-11 shrink-0 border-b px-2 flex items-center justify-between gap-2 transition-colors">
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        <span aria-label="Mosaic" title="Mosaic" className="grid h-8 w-8 shrink-0 place-items-center text-[#0078d4]"><Blocks size={19} /></span>
        <nav aria-label="Application menu" className="flex h-11 min-w-0 items-center gap-0.5">
          {menus.map((menu) => (
            <div key={menu.label} data-app-menu className="relative flex h-full items-center">
              <button type="button" aria-expanded={openMenu === menu.label} onClick={() => setOpenMenu((current) => current === menu.label ? null : menu.label)} onMouseEnter={() => { if (openMenu) setOpenMenu(menu.label); }} className={`h-8 px-1.5 text-xs text-[#cccccc] hover:bg-[#2b2b2b] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#0078d4] ${openMenu === menu.label ? "bg-[#2b2b2b]" : ""}`}>
                {menu.label}
              </button>
              {openMenu === menu.label && <div className="absolute left-0 top-full z-[80] min-w-56 border border-[#3c3c3c] bg-[#1f1f1f] py-1 shadow-xl">
                {menu.actions.map((item) => <button key={item.label} type="button" disabled={item.disabled} onClick={() => { item.action?.(); setOpenMenu(null); }} className="flex min-h-7 w-full items-center justify-between gap-8 px-3 text-left text-xs text-[#cccccc] hover:bg-[#04395e] disabled:text-[#858585] disabled:hover:bg-transparent">
                  <span>{item.label}</span>{item.shortcut && <span className="text-[#9d9d9d]">{item.shortcut}</span>}
                </button>)}
              </div>}
            </div>
          ))}
        </nav>
      </div>

      {/* Middle: Centered Spotlight Search Container */}
      <div className="mx-auto flex min-w-0 flex-1 items-center justify-center gap-2 px-3">
        <button type="button" aria-label="Back" title="Back" onClick={() => window.history.back()} className="grid h-8 w-7 shrink-0 place-items-center text-[#9d9d9d] hover:bg-[#2b2b2b] hover:text-[#cccccc]"><ArrowLeft size={16} /></button>
        <button type="button" aria-label="Forward" title="Forward" onClick={() => window.history.forward()} className="grid h-8 w-7 shrink-0 place-items-center text-[#9d9d9d] hover:bg-[#2b2b2b] hover:text-[#cccccc]"><ArrowRight size={16} /></button>
      <div ref={searchContainerRef} className="relative w-[min(44vw,640px)] min-w-40 shrink">
        <div className="relative flex items-center">
          <Search size={15} className="absolute left-3.5 text-gray-400 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => { setIsOpen(true); onOpenSearch?.(); }}
            placeholder="mosaic-personal"
            className="w-full pl-10 pr-9 py-1.5 text-xs bg-[#252526] border border-[#3c3c3c] rounded-none shadow-2xs focus:outline-none focus:border-[#0078d4] focus:ring-1 focus:ring-[#0078d4] transition-all text-[#cccccc] placeholder:text-[#858585]"
          />
          {searchQuery ? (
            <button
              onClick={() => {
                setSearchQuery("");
                setIsOpen(false);
              }}
              className="absolute right-2.5 text-gray-400 hover:text-gray-600 p-0.5"
            >
              <X size={14} />
            </button>
          ) : (
            <kbd className="absolute right-2.5 hidden sm:inline-flex items-center px-1.5 py-0.5 text-[9px] font-mono text-gray-400 bg-[#FFFCFB] border border-gray-200 rounded-none">Ctrl+P</kbd>
          )}
        </div>

        {/* Spotlight Results Dropdown */}
        {isOpen && query && (
          <div className="absolute left-0 right-0 mt-2 bg-[#FFFCFB] border border-gray-200 rounded-none shadow-xl overflow-hidden z-50 max-h-[420px] overflow-y-auto animate-in fade-in zoom-in-95 duration-100">
            {hasResults ? (
              <div className="p-2 divide-y divide-gray-100 text-xs">
                {/* 1. APP PAGES */}
                {matchedPages.length > 0 && (
                  <div className="py-2 first:pt-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#C9AB4C] px-2 block mb-1">
                      Pages & Views
                    </span>
                    {matchedPages.map((p) => {
                      const IconComponent = p.icon;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            if (onNavigateToPage) onNavigateToPage(p.id === "project" ? "business-analysis" : p.id);
                            setIsOpen(false);
                          }}
                          className="w-full text-left px-2.5 py-2 rounded-none hover:bg-[#FFFCFB] flex items-center justify-between group transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <IconComponent size={14} className="text-[#003366] shrink-0" />
                            <div>
                              <div className="font-semibold text-[#1b1d1e] group-hover:text-[#003366]">
                                {p.name}
                              </div>
                              <div className="text-[10px] text-gray-400">{p.description}</div>
                            </div>
                          </div>
                          <ArrowRight size={13} className="text-gray-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* 3. MEETINGS */}
                {matchedMeetings.length > 0 && (
                  <div className="py-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#C9AB4C] px-2 block mb-1">
                      Meetings
                    </span>
                    {matchedMeetings.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          onSelectMeeting(m.id);
                          setIsOpen(false);
                        }}
                        className="w-full text-left px-2.5 py-2 rounded-none hover:bg-[#FFFCFB] flex items-center justify-between group transition-colors"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <Calendar size={14} className="text-[#003366] shrink-0" />
                          <div className="truncate">
                            <div className="font-semibold text-[#1b1d1e] group-hover:text-[#003366] truncate">
                              {m.title}
                            </div>
                            <div className="text-[10px] text-gray-400 truncate">
                              {formatEchoDate(m.date)} â€¢ {m.location || "Scheduled Venue"}
                            </div>
                          </div>
                        </div>
                        <ArrowRight size={13} className="text-gray-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all shrink-0 ml-2" />
                      </button>
                    ))}
                  </div>
                )}

                {/* 4. TOPICS & ACTIONS */}
                {matchedTopics.length > 0 && (
                  <div className="py-2 last:pb-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#C9AB4C] px-2 block mb-1">
                      Topics & Action Plans
                    </span>
                    {matchedTopics.map((t, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          onSelectMeeting(t.meetingId);
                          setIsOpen(false);
                        }}
                        className="w-full text-left px-2.5 py-2 rounded-none hover:bg-[#FFFCFB] flex items-center justify-between group transition-colors"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <FileText size={14} className="text-[#C9AB4C] shrink-0" />
                          <div className="truncate">
                            <div className="font-medium text-[#1b1d1e] group-hover:text-[#003366] truncate">
                              {t.topic}
                            </div>
                            <div className="text-[10px] text-gray-400 truncate max-w-sm">
                              In {t.meetingTitle} â€¢ {t.action || "No action plan"}
                            </div>
                          </div>
                        </div>
                        <ArrowRight size={13} className="text-gray-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all shrink-0 ml-2" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 text-center text-gray-400 text-xs">
                No matching results found across pages or meetings for &ldquo;{searchQuery}&rdquo;
              </div>
            )}
          </div>
        )}
      </div>

      </div>

      <div className="flex shrink-0 items-center gap-1">
        {studioRecording?.active && <button type="button" onClick={studioRecording.onRestore} title="Open current meeting" aria-label={`${studioRecording.isPaused ? "Paused" : "Recording"} ${formatMeetingClock(studioRecording.elapsedSeconds)}`} className="flex h-8 items-center gap-2 border-l border-[#2b2b2b] px-2 text-xs text-[#cccccc] hover:bg-[#2b2b2b]"><span className={`h-2 w-2 rounded-full ${studioRecording.isPaused ? "bg-[#d29922]" : "bg-[#f85149] animate-pulse"}`} />{studioRecording.isPaused ? "Paused" : "Recording"} {formatMeetingClock(studioRecording.elapsedSeconds)}</button>}
        {showNewMeeting && (!allowedPages || allowedPages.includes("minutes")) && <button type="button" onClick={onGoToNotetaker} title="New meeting" aria-label="New meeting" className="grid h-8 w-8 place-items-center text-[#9d9d9d] hover:bg-[#2b2b2b] hover:text-[#cccccc]"><CalendarPlus size={15} /></button>}
        {hasDesktopSync && (() => {
          const syncing = manualSyncing || syncStatus.status === "syncing";
          const failed = syncStatus.status === "failed";
          const label = failed ? "Sync issue" : syncStatus.status === "synced" ? "Synced" : syncing ? "Syncing" : "Sync";
          const tone = failed ? "text-[#f85149]" : syncStatus.status === "synced" ? "text-[#3fb950]" : "text-[#9d9d9d]";
          return <div className="relative">
            <button type="button" onClick={() => void runManualSync()} disabled={syncing} aria-busy={syncing} aria-label={`${label} Supabase`} title={syncStatus.error || `${label} workspace records with Supabase`} className={`grid h-8 w-8 place-items-center ${tone} hover:bg-[#2b2b2b] disabled:opacity-60`}>
              <RefreshCw aria-hidden="true" size={14} className={syncing ? "animate-spin" : ""} />
            </button>
            {syncDetailsOpen && <section role="status" aria-live="polite" className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] border border-[#3c3c3c] bg-[#1f1f1f] p-3 text-[#cccccc] shadow-lg">
              <div className="flex items-center justify-between gap-3 border-b border-[#2b2b2b] pb-2"><h2 className="text-xs font-semibold">{failed ? "Sync needs attention" : syncStatus.status === "synced" ? "Sync complete" : syncing ? "Syncing workspace" : "Supabase sync"}</h2><button type="button" onClick={() => setSyncDetailsOpen(false)} aria-label="Close sync details" className="grid h-7 w-7 place-items-center text-[#9d9d9d] hover:bg-[#2b2b2b]"><X size={14} /></button></div>
              <p className="py-2 text-[11px] text-[#9d9d9d]">{syncStatus.error || (syncStatus.status === "not-configured" ? "Configure Supabase in Settings to enable sync." : syncStatus.status === "synced" ? `${syncStatus.uploaded || 0} uploaded · ${syncStatus.downloaded || 0} downloaded · ${syncStatus.deleted || 0} deleted.` : "Local records stay available while sync runs.")}</p>
              {(syncStatus.status === "syncing" || manualSyncing) && <div className="relative mt-3 h-1 overflow-hidden bg-[#2b2b2b]"><span className="mosaic-sync-progress-bar" /></div>}
            </section>}
          </div>;
        })()}        {onOpenUpdates && <button type="button" onClick={onOpenUpdates} aria-label="Check for updates" title="Check for updates" className="grid h-8 w-8 place-items-center text-[#9d9d9d] hover:bg-[#2b2b2b] hover:text-[#cccccc]"><CloudDownload size={15} /></button>}
        {askEchoEnabled && (!allowedFeatures || allowedFeatures.includes("ask-echo")) && (!allowedPages || allowedPages.includes("minutes")) && <button type="button" onClick={onOpenUniversalEcho} aria-label="Ask Echo" title="Ask Echo" className="grid h-8 w-8 place-items-center text-[#cccccc] hover:bg-[#2b2b2b] hover:text-white"><MessageSquarePlus size={16} /></button>}
      </div>

    </header>
  );
}
