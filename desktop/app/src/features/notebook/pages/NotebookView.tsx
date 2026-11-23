"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearBrowserPageCache, getBrowserPageCache, readBrowserPageCache, writeBrowserPageCache } from "@/lib/browserPageCache";
import { requestCentralClickUpSync, trackClickUpLiveRefresh } from "@/lib/clickupSyncClient";

const desktopMode = process.env.NEXT_PUBLIC_MOSAIC_DESKTOP === "1";
import {
  AlertCircle,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  Users,
} from "lucide-react";

type CategoryKey = "client" | "admin" | "adhoc" | "meetings";

export interface NotebookActivityHistoryEntry {
  id: string;
  name: string;
  date: string;
  url: string;
  member: { id: string; name: string };
  categories: Record<CategoryKey, string>;
}

export interface NotebookActivityHistory {
  start: string;
  end: string;
  isCurrentUser: boolean;
  isFresh: boolean;
  entries: NotebookActivityHistoryEntry[];
}

interface NotebookMember {
  id: string;
  name: string;
  email: string;
  initials: string;
  profilePicture: string | null;
  months?: string[];
}

interface NotebookEntry extends NotebookActivityHistoryEntry {
  status: string;
  member: NotebookMember;
  hasContent: boolean;
  dailyTasks?: Array<{ id: string; name: string; status: string; completed: boolean; dueDate: string; url: string; description?: string; priority?: string }>;
}

interface NotebookPayload {
  listId: string;
  entries: NotebookEntry[];
  members: NotebookMember[];
  fetchedAt: string;
  warning?: string;
}

function localIso(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromIso(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(value: string, options?: Intl.DateTimeFormatOptions) {
  return fromIso(value).toLocaleDateString("en-US", options || {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function shiftDate(value: string, days: number) {
  const date = fromIso(value);
  date.setDate(date.getDate() + days);
  return localIso(date);
}

function startOfWeek(value: string) {
  const date = fromIso(value);
  const offset = date.getDay() === 0 ? -6 : 1 - date.getDay();
  date.setDate(date.getDate() + offset);
  return localIso(date);
}

function weekdaysInRange(start: string, end: string) {
  if (!start || !end || start > end) return [];
  const today = localIso(new Date());
  if (start > today) return [];
  const finalDate = end > today ? today : end;
  const days: string[] = [];
  for (let date = start; date <= finalDate; date = shiftDate(date, 1)) {
    const day = fromIso(date).getDay();
    if (day !== 0 && day !== 6) days.push(date);
  }
  return days;
}

function presetRange(preset: "this-week" | "last-week" | "this-month" | "last-month") {
  const today = localIso(new Date());
  if (preset === "this-week") return { start: startOfWeek(today), end: today };
  if (preset === "last-week") {
    const lastWeekEnd = shiftDate(startOfWeek(today), -1);
    return { start: startOfWeek(lastWeekEnd), end: lastWeekEnd };
  }
  const current = fromIso(today);
  if (preset === "this-month") return { start: `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-01`, end: today };
  const lastMonth = new Date(current.getFullYear(), current.getMonth() - 1, 1);
  const end = new Date(current.getFullYear(), current.getMonth(), 0);
  return { start: localIso(lastMonth), end: localIso(end) };
}

function MemberAvatar({ member }: { member: NotebookMember }) {
  if (member.profilePicture) {
    return <img src={member.profilePicture} alt="" className="w-8 h-8 object-cover border border-warning-border shrink-0" />;
  }
  return (
    <span className="w-8 h-8 bg-action text-on-action flex items-center justify-center text-xs font-bold shrink-0">
      {member.initials || member.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function NotebookView({ currentUserName, userId, initialDate, initialTab = "today", hideViewTabs = false, hidePageTitle = false, onOpenDay, onActivityHistoryLoad }: {
  currentUserName?: string;
  userId?: string;
  initialDate?: string;
  initialTab?: "today" | "week" | "insights";
  hideViewTabs?: boolean;
  hidePageTitle?: boolean;
  onOpenDay?: (date: string) => void;
  onActivityHistoryLoad?: (history: NotebookActivityHistory | null) => void;
}) {
  const today = localIso(new Date());
  const [activeTab, setActiveTab] = useState<"today" | "week" | "insights">(initialTab);
  const [selectedDate, setSelectedDate] = useState(initialDate || today);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [insightMemberId, setInsightMemberId] = useState("all");
  const [rangePreset, setRangePreset] = useState<"this-week" | "last-week" | "this-month" | "last-month" | "custom">("this-month");
  const initialRange = presetRange("this-month");
  const [rangeStart, setRangeStart] = useState(initialRange.start);
  const [rangeEnd, setRangeEnd] = useState(initialRange.end);
  const [payload, setPayload] = useState<NotebookPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [targetGenMonth, setTargetGenMonth] = useState(() => today.slice(0, 7));
  const [generatingMonth, setGeneratingMonth] = useState(false);
  const [generatingProgress, setGeneratingProgress] = useState("");
  const [generateFeedback, setGenerateFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const notebookRequestVersion = useRef(0);
  const loadedCurrentUserRange = useRef("");
  const onActivityHistoryLoadRef = useRef(onActivityHistoryLoad);
  onActivityHistoryLoadRef.current = onActivityHistoryLoad;

  useEffect(() => {
    setTargetGenMonth(selectedDate.slice(0, 7));
  }, [selectedDate]);

  const requestedMemberId = activeTab === "insights"
    ? insightMemberId === "all" ? "" : insightMemberId
    : selectedMemberId;
  const requestCurrentUser = activeTab !== "insights" && !requestedMemberId;
  const currentUserMemberSlug = currentUserName?.trim().toLowerCase().replace(/\s+/g, "-");
  const publishActivityHistory = useCallback((source: NotebookPayload, isFresh: boolean) => {
    const normalizedCurrentUserName = currentUserName?.trim().toLowerCase();
    const selectedMemberIsCurrentUser = Boolean(
      requestedMemberId && normalizedCurrentUserName && source.members.some((item) =>
        item.id === requestedMemberId && item.name.trim().toLowerCase() === normalizedCurrentUserName,
      ),
    );
    onActivityHistoryLoadRef.current?.({
      start: rangeStart,
      end: rangeEnd,
      isCurrentUser: requestCurrentUser || Boolean(userId && requestedMemberId === userId) || selectedMemberIsCurrentUser,
      isFresh,
      entries: source.entries || [],
    });
  }, [currentUserName, rangeEnd, rangeStart, requestCurrentUser, requestedMemberId, userId]);
  const loadNotebook = async (background = Boolean(payload)) => {
    const requestVersion = ++notebookRequestVersion.current;
    const cacheKey = `notebook:${rangeStart}:${rangeEnd}:${requestedMemberId || (requestCurrentUser ? "current" : "all")}`;
    if (!background) setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ start: rangeStart, end: rangeEnd });
      query.set("liveRefresh", "1");
      if (requestedMemberId) query.set("memberId", requestedMemberId);
      else if (requestCurrentUser) query.set("currentUser", "1");
      const response = await fetch(`/api/notebook?${query}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(body.error || "Unable to load the daily log."), { status: response.status });
      if (requestVersion !== notebookRequestVersion.current) return;
      setPayload(body);
      if (requestCurrentUser) loadedCurrentUserRange.current = `${rangeStart}:${rangeEnd}`;
      publishActivityHistory(body as NotebookPayload, true);
      if (userId) void writeBrowserPageCache(userId, cacheKey, body as NotebookPayload);
    } catch (loadError) {
      if (requestVersion !== notebookRequestVersion.current) return;
      if (!payload) onActivityHistoryLoadRef.current?.(null);
      if (userId && loadError && typeof loadError === "object" && "status" in loadError && [401, 403].includes(Number(loadError.status))) await clearBrowserPageCache(userId);
      setError(loadError instanceof Error ? loadError.message : "Unable to load the daily log.");
      if (background) throw loadError;
    } finally {
      if (requestVersion === notebookRequestVersion.current) setLoading(false);
    }
  };
  const loadNotebookRef = useRef(loadNotebook);
  useEffect(() => { loadNotebookRef.current = loadNotebook; });

  const requestNotebookRefresh = async () => {
    setError("");
    if (desktopMode) { await loadNotebook(false); return; }
    try {
      await requestCentralClickUpSync();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Unable to start ClickUp refresh.");
    }
  };

  useEffect(() => {
    let active = true;
    if (
      requestedMemberId && loadedCurrentUserRange.current === `${rangeStart}:${rangeEnd}` &&
      (requestedMemberId === userId || requestedMemberId === currentUserMemberSlug)
    ) return;
    const cacheKey = `notebook:${rangeStart}:${rangeEnd}:${requestedMemberId || (requestCurrentUser ? "current" : "all")}`;
    const publishCachedPreview = (cached: NotebookPayload) => {
      setPayload(cached);
      setLoading(false);
      if (requestCurrentUser) loadedCurrentUserRange.current = `${rangeStart}:${rangeEnd}`;
      publishActivityHistory(cached, false);
    };
    let liveRequestSettled = false;
    const liveRequest = loadNotebookRef.current(false).finally(() => { liveRequestSettled = true; });
    const inMemoryCache = userId ? getBrowserPageCache<NotebookPayload>(userId, cacheKey) : undefined;
    if (inMemoryCache && !liveRequestSettled) publishCachedPreview(inMemoryCache);
    if (userId && !inMemoryCache) {
      void readBrowserPageCache<NotebookPayload>(userId, cacheKey).then((cached) => {
        if (cached && active && !liveRequestSettled) publishCachedPreview(cached);
      }).catch(() => undefined);
    }
    void liveRequest;
    return () => { active = false; };
  }, [userId, rangeStart, rangeEnd, requestedMemberId, requestCurrentUser, currentUserMemberSlug, publishActivityHistory]);

  useEffect(() => {
    const refreshAfterSync = (event: Event) => { trackClickUpLiveRefresh(event, () => loadNotebookRef.current(true), "Daily Log"); };
    window.addEventListener("mosaic-clickup-sync-complete", refreshAfterSync);
    return () => window.removeEventListener("mosaic-clickup-sync-complete", refreshAfterSync);
  }, []);

  useEffect(() => {
    if (!payload?.members.length || selectedMemberId) return;
    const current = currentUserName?.toLowerCase().trim();
    const matched = payload.members.find((member) => member.name.toLowerCase().trim() === current);
    setSelectedMemberId((matched || payload.members[0]).id);
  }, [payload, selectedMemberId, currentUserName]);

  const member = payload?.members.find((item) => item.id === selectedMemberId) || payload?.members[0];
  const entries = payload?.entries || [];

  const selectedDayEntries = useMemo(
    () => entries.filter((entry) => entry.date === selectedDate && entry.member.id === member?.id),
    [entries, selectedDate, member?.id],
  );
  const selectedDayEntry = selectedDayEntries[0];

  const workdays = useMemo(() => weekdaysInRange(rangeStart, rangeEnd), [rangeStart, rangeEnd]);

  const completenessRows = useMemo(() => (payload?.members || []).map((person) => {
    const personEntries = entries.filter((entry) => entry.member.id === person.id && entry.date >= rangeStart && entry.date <= rangeEnd);
    const byDate = new Map<string, NotebookEntry[]>();
    personEntries.forEach((entry) => byDate.set(entry.date, [...(byDate.get(entry.date) || []), entry]));
    const submittedDates = workdays.filter((date) => (byDate.get(date) || []).some((entry) => entry.hasContent));
    const emptyDates = workdays.filter((date) => byDate.has(date) && !(byDate.get(date) || []).some((entry) => entry.hasContent));
    const emptyDays = workdays.filter((date) => !byDate.has(date));
    return {
      member: person,
      submittedDates,
      emptyDates,
      emptyDays,
      percent: workdays.length ? Math.round((submittedDates.length / workdays.length) * 100) : 0,
      byDate,
    };
  }), [payload?.members, entries, rangeStart, rangeEnd, workdays]);

  const activeRows = completenessRows.filter((row) => row.byDate.size > 0 || row.member.months?.some((month) => month >= rangeStart.slice(0, 7) && month <= rangeEnd.slice(0, 7)));
  const displayedRows = activeRows.length ? activeRows : completenessRows;
  const filteredRows = (insightMemberId === "all" ? displayedRows : displayedRows.filter((row) => row.member.id === insightMemberId)).slice().sort((left, right) => right.percent - left.percent || left.member.name.localeCompare(right.member.name));
  const expectedLogs = workdays.length * filteredRows.length;
  const submittedLogs = filteredRows.reduce((sum, row) => sum + row.submittedDates.length, 0);
  const emptyDayLogs = filteredRows.reduce((sum, row) => sum + row.emptyDays.length, 0);
  const averageCompleteness = expectedLogs ? Math.round((submittedLogs / expectedLogs) * 100) : 0;

  const previousDay = () => setSelectedDate((value) => shiftDate(value, -1));
  const nextDay = () => setSelectedDate((value) => shiftDate(value, 1));

  const applyPreset = (preset: "this-week" | "last-week" | "this-month" | "last-month" | "custom") => {
    setRangePreset(preset);
    if (preset === "custom") return;
    const range = presetRange(preset);
    setRangeStart(range.start);
    setRangeEnd(range.end);
  };

  const availableMonths = useMemo(() => {
    const list: Array<{ value: string; label: string }> = [];
    const base = new Date();
    for (let i = -6; i <= 2; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      list.push({ value: val, label });
    }
    if (targetGenMonth && !list.some((item) => item.value === targetGenMonth)) {
      const [y, m] = targetGenMonth.split("-").map(Number);
      if (y && m) {
        const d = new Date(y, m - 1, 1);
        list.push({
          value: targetGenMonth,
          label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        });
        list.sort((a, b) => a.value.localeCompare(b.value));
      }
    }
    return list;
  }, [targetGenMonth]);

  const monthStats = useMemo(() => {
    if (!targetGenMonth || !member) return { totalWeekdays: 0, existingCount: 0, missingCount: 0, monthName: "" };
    const [year, month] = targetGenMonth.split("-").map(Number);
    if (!year || !month) return { totalWeekdays: 0, existingCount: 0, missingCount: 0, monthName: "" };

    const totalDays = new Date(year, month, 0).getDate();
    let weekdays = 0;
    const weekdaySet = new Set<string>();
    for (let d = 1; d <= totalDays; d++) {
      const dateObj = new Date(year, month - 1, d, 12, 0, 0);
      const dayOfWeek = dateObj.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        weekdays++;
        weekdaySet.add(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
      }
    }

    const memberMonthEntries = entries.filter(
      (e) => e.member.id === member.id && weekdaySet.has(e.date),
    );
    const existingDates = new Set(memberMonthEntries.map((e) => e.date));
    const existingCount = existingDates.size;
    const missingCount = Math.max(0, weekdays - existingCount);
    const monthName = new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

    return { totalWeekdays: weekdays, existingCount, missingCount, monthName };
  }, [targetGenMonth, member, entries]);

  const handleGenerateMonthTasks = async () => {
    if (!member || generatingMonth) return;
    setGeneratingMonth(true);
    setGenerateFeedback(null);
    setGeneratingProgress(desktopMode ? "Preparing local entries…" : "Preparing ClickUp tasks…");
    let totalCreated = 0;
    let iterations = 0;
    const maxIterations = 15;
    try {
      while (iterations < maxIterations) {
        iterations++;
        const response = await fetch("/api/notebook/generate-month", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            month: targetGenMonth,
            member: { id: member.id, name: member.name },
            limit: 5,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to generate monthly tasks.");
        }
        totalCreated += data.createdCount || 0;
        const remaining = data.remainingCount ?? 0;

        if (remaining > 0 && data.createdCount > 0) {
          setGeneratingProgress(`Created ${totalCreated} tasks… (${remaining} remaining)`);
          // Brief pause between batches
          await new Promise((r) => setTimeout(r, 600));
        } else {
          break;
        }
      }

      if (totalCreated === 0) {
        setGenerateFeedback({
          type: "success",
          text: desktopMode ? `All weekday entries already exist for ${monthStats.monthName}.` : `All weekday tasks already exist in ClickUp for ${monthStats.monthName}.`,
        });
      } else {
        setGenerateFeedback({
          type: "success",
          text: `Successfully created ${totalCreated} weekday placeholder task${totalCreated === 1 ? "" : "s"} for ${monthStats.monthName}!`,
        });
      }
      await loadNotebook();
    } catch (genErr) {
      setGenerateFeedback({
        type: "error",
        text: genErr instanceof Error ? genErr.message : "Unable to generate tasks.",
      });
    } finally {
      setGeneratingMonth(false);
      setGeneratingProgress("");
    }
  };

  if (loading && !payload) {
    return (
      <div className="min-h-[460px] flex items-center justify-center text-fg">
        <div className="flex items-center gap-3 text-sm font-semibold"><Loader2 className="animate-spin" size={20} /> Loading team notebook…</div>
      </div>
    );
  }

  if (error && !payload) {
    return (
      <div className="max-w-xl mx-auto mt-16 bg-surface-panel border border-danger-border p-7 text-center">
        <AlertCircle className="mx-auto text-danger-fg mb-3" size={26} />
        <h1 className="text-xl">Notebook unavailable</h1>
        <p className="text-sm text-fg-secondary mt-2">{error}</p>
        <button type="button" onClick={() => void requestNotebookRefresh()} className="btn-outline mt-5 inline-flex items-center gap-2"><RefreshCw size={14} /> Try again</button>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4 pb-4 border-b border-line">
        {!hidePageTitle && <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-serif font-bold text-fg italic">Notebook</h1>
          </div>
          <p className="text-sm text-fg-muted mt-1">Review your daily activity and team logging progress.</p>
        </div>}
        <div className="flex items-center gap-2 flex-wrap">
          {activeTab !== "insights" && payload && payload.members.length > 0 && (
            <select
              value={member?.id || ""}
              onChange={(event) => setSelectedMemberId(event.target.value)}
              aria-label="Team member"
              className="h-10 min-w-52 bg-surface-panel border border-line px-3 text-sm text-fg focus:outline-none focus:border-focus"
            >
              {payload.members.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          )}
          <button
            type="button"
            onClick={() => void requestNotebookRefresh()}
            disabled={loading}
            className="h-10 px-3 bg-surface-panel border border-line text-fg text-sm font-semibold flex items-center gap-2 hover:border-warning-border "
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      <div className="bg-surface-panel border border-line shadow-2xs p-2 flex items-center justify-between gap-3 flex-wrap">
        {!hideViewTabs && <div className="inline-flex border border-line bg-surface-panel" role="tablist" aria-label="Notebook views">
          {([
            ["today", "Today"],
            ["week", "Daily activity"],
            ["insights", "Dashboard"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => setActiveTab(id)}
              className={`h-10 px-5 text-sm font-semibold border-r last:border-r-0 border-line transition-colors ${
                activeTab === id ? "bg-action text-on-action border-b-2 border-focus" : "bg-surface-panel text-fg-muted hover:text-fg hover:bg-surface-hover"
              }`}
            >
              {label}
            </button>
          ))}
        </div>}

        {activeTab === "insights" ? (
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-fg-muted"><span className="hidden 2xl:inline">View</span><select value={insightMemberId} onChange={(event) => setInsightMemberId(event.target.value)} aria-label="Insight team member" className="h-10 min-w-52 bg-surface-panel border border-line px-3 text-sm font-medium normal-case tracking-normal text-fg focus:outline-none focus:border-focus">
              <option value="all">All team members</option>
              {(payload?.members || []).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select></label>
            <select value={rangePreset} onChange={(event) => applyPreset(event.target.value as "this-week" | "last-week" | "this-month" | "last-month" | "custom")} aria-label="Reporting range preset" className="h-10 bg-action border border-link px-3 text-sm font-medium text-on-action focus:outline-none focus:ring-1 focus:ring-focus">
              <option value="this-week">This week</option>
              <option value="last-week">Last week</option>
              <option value="this-month">This month</option>
              <option value="last-month">Last month</option>
              <option value="custom">Custom range</option>
            </select>
            <input type="date" value={rangeStart} onChange={(event) => { setRangePreset("custom"); setRangeStart(event.target.value); }} aria-label="Reporting range start" className="h-10 bg-surface-panel border border-line px-3 text-sm focus:outline-none focus:border-focus" />
            <span className="text-sm text-fg-muted">to</span>
            <input type="date" value={rangeEnd} onChange={(event) => { setRangePreset("custom"); setRangeEnd(event.target.value); }} aria-label="Reporting range end" className="h-10 bg-surface-panel border border-line px-3 text-sm focus:outline-none focus:border-focus" />
          </div>
        ) : activeTab === "week" ? (
          <div className="flex items-center gap-2 flex-wrap">
            <select value={rangePreset} onChange={(event) => applyPreset(event.target.value as "this-week" | "last-week" | "this-month" | "last-month" | "custom")} aria-label="Activity period" className="h-10 bg-action border border-link px-3 text-sm font-medium text-on-action focus:outline-none focus:ring-1 focus:ring-focus">
              <option value="this-week">This week</option><option value="last-week">Last week</option><option value="this-month">This month</option><option value="last-month">Last month</option><option value="custom">Custom range</option>
            </select>
            <input type="date" value={rangeStart} onChange={(event) => { setRangePreset("custom"); setRangeStart(event.target.value); }} aria-label="Activity start date" className="h-10 bg-surface-panel border border-line px-3 text-sm focus:outline-none focus:border-focus" />
            <span className="text-sm text-fg-muted">to</span>
            <input type="date" value={rangeEnd} onChange={(event) => { setRangePreset("custom"); setRangeEnd(event.target.value); }} aria-label="Activity end date" className="h-10 bg-surface-panel border border-line px-3 text-sm focus:outline-none focus:border-focus" />
          </div>
        ) : (
          <div className="flex items-center bg-surface-panel border border-line">
            <button type="button" onClick={previousDay} aria-label="Previous day" className="w-10 h-10 grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-hover"><ChevronLeft size={17} /></button>
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="h-10 border-x border-y-0 border-line px-3 text-sm text-fg focus:outline-none" />
            <button type="button" onClick={nextDay} aria-label="Next day" className="w-10 h-10 grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-hover"><ChevronRight size={17} /></button>
          </div>
        )}
      </div>

      {loading && payload && <p role="status" className="border border-line bg-surface-raised px-3 py-2 text-xs text-fg-secondary">{desktopMode ? "Loading local entries. Showing the last loaded range until it finishes." : "Loading this date range from ClickUp. Showing the last loaded range until it finishes."}</p>}
      {error && <div className="border border-warning-border bg-warning-surface text-warning-fg px-4 py-3 text-sm">Showing the last loaded data. Refresh failed: {error}</div>}
      {payload?.warning && <div role="status" className="border border-warning-border bg-warning-surface text-warning-fg px-4 py-3 text-sm">{payload.warning}</div>}

      {activeTab === "today" && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <section className="lg:col-span-8">
              <div className="flex items-end justify-between gap-4 mb-3">
                <div>
                  <h2 className="text-xl">{formatDate(selectedDate)}</h2>
                  <p className="text-sm text-fg-muted mt-1">{member?.name || "Team member"}</p>
                </div>
                <span className={`text-xs font-bold uppercase tracking-wider px-2.5 py-1 border ${selectedDayEntries.some((entry) => entry.hasContent) ? "text-success-fg bg-success-surface border-success-border" : "text-warning-fg bg-warning-surface border-warning-border"}`}>
                  {selectedDayEntries.some((entry) => entry.hasContent) ? "Tasks recorded" : "No tasks recorded"}
                </span>
              </div>

              <section className="mt-4 border border-line bg-surface-panel p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-lg font-serif italic text-fg">My Day tasks</h3>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{selectedDayEntry?.dailyTasks?.length || 0} item{(selectedDayEntry?.dailyTasks?.length || 0) === 1 ? "" : "s"}</span>
                </div>
                <p className="mt-1 text-xs text-fg-muted">Tasks created in My Day appear in that day’s daily log.</p>
                {selectedDayEntry?.dailyTasks?.length ? (
                  <ul className="mt-3 divide-y divide-line border-t border-line">
                    {selectedDayEntry.dailyTasks.map((task) => <li key={task.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <span className={`text-xs ${task.completed ? "text-fg-muted line-through" : "text-fg"}`}>{task.name}</span>
                        {task.description && <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-fg-muted">{task.description}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-[10px] text-fg-muted">
                        <span className={task.completed ? "text-success-fg" : "text-fg-muted"}>{task.completed ? "Completed" : "Open"}</span>
                        {task.priority && <span className={task.priority === "high" ? "border border-warning-border bg-warning-surface px-1.5 py-0.5 text-warning-fg" : "border border-line bg-surface-raised px-1.5 py-0.5 text-fg-muted"}>{task.priority === "high" ? "High priority" : "Normal priority"}</span>}
                        {task.dueDate && <span>Due {new Date(`${task.dueDate}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                        {!desktopMode && task.url && <a href={task.url} target="_blank" rel="noreferrer" aria-label={`Open ${task.name} in ClickUp`} className="text-fg-secondary hover:text-fg"><ExternalLink size={12} /></a>}
                      </div>
                    </li>)}
                  </ul>
                ) : <p className="mt-3 border-t border-line pt-3 text-xs text-fg-muted">No My Day tasks are linked to this date yet.</p>}
              </section>
            </section>

            <aside className="lg:col-span-4 space-y-4">
              <div className="bg-surface-panel border border-line p-5">
                <h3 className="text-lg flex items-center gap-2"><FileText size={17} className="text-link" /> Source record</h3>
                <p className="text-sm text-fg-muted mt-2 leading-relaxed">{desktopMode ? "Daily records stay on this device. My Day tasks are shown here." : "Edit directly here. Mosaic keeps the same month parent and daily subtask structure your team already uses in ClickUp."}</p>
                {selectedDayEntries[0]?.url ? (
                  <a href={selectedDayEntries[0].url} target="_blank" rel="noreferrer" className="mt-4 btn-outline !px-4 !py-2 inline-flex items-center gap-2">
                    Open daily log <ExternalLink size={14} />
                  </a>
                ) : <p className="text-xs text-fg-muted mt-4">{desktopMode ? "No local daily record exists for this date yet." : "Save an entry to create this date in ClickUp."}</p>}
              </div>
              <div className="bg-surface-panel border border-line p-5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg flex items-center gap-2">
                    <CalendarPlus size={17} className="text-link" /> Month Placeholders
                  </h3>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-fg bg-info-surface px-2 py-0.5 border border-link">
                    {desktopMode ? "Local" : "ClickUp"}
                  </span>
                </div>
                <p className="text-xs text-fg-muted mt-2 leading-relaxed">
                  {desktopMode ? "Create a local daily log for each weekday of a month." : `Generate placeholder daily tasks in ClickUp for all weekdays of a month under ${member?.name || "the member"}'s parent task.`}
                </p>

                <div className="mt-4 space-y-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-fg-muted mb-1">
                      Target Month
                    </label>
                    <select
                      value={targetGenMonth}
                      onChange={(e) => {
                        setTargetGenMonth(e.target.value);
                        setGenerateFeedback(null);
                      }}
                      disabled={generatingMonth}
                      className="w-full h-9 bg-surface-panel border border-line px-2.5 text-xs text-fg focus:outline-none focus:border-focus"
                    >
                      {availableMonths.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center justify-between text-xs py-1.5 px-2 bg-surface-raised border border-line">
                    <span className="text-fg-secondary">Existing weekdays:</span>
                    <span className="font-semibold text-fg">
                      {monthStats.existingCount} / {monthStats.totalWeekdays} tasks
                    </span>
                  </div>

                  {generateFeedback && (
                    <div
                      className={`text-xs p-2.5 border flex items-start gap-1.5 ${
                        generateFeedback.type === "success"
                          ? "bg-success-surface border-success-border text-success-fg"
                          : "bg-danger-surface border-danger-border text-danger-fg"
                      }`}
                    >
                      {generateFeedback.type === "success" ? (
                        <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-success-fg" />
                      ) : (
                        <AlertCircle size={14} className="shrink-0 mt-0.5 text-danger-fg" />
                      )}
                      <span>{generateFeedback.text}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleGenerateMonthTasks}
                    disabled={generatingMonth || !member}
                    className="w-full h-10 bg-action text-on-action text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-action-hover  transition-colors shadow-xs"
                  >
                    {generatingMonth ? (
                      <>
                        <Loader2 size={14} className="animate-spin shrink-0" />
                        <span className="truncate">{generatingProgress || "Generating ClickUp Tasks…"}</span>
                      </>
                    ) : (
                      <>
                        <CalendarPlus size={14} />
                        {monthStats.missingCount > 0
                          ? `Generate ${monthStats.missingCount} Missing Tasks`
                          : `Sync ${monthStats.monthName} Tasks`}
                      </>
                    )}
                  </button>
                </div>
              </div>
              <div className="bg-surface-panel border border-warning-border p-5 text-on-action">
                <div className="text-xs uppercase tracking-widest text-link font-bold">Daily completeness</div>
                <div className="text-3xl font-serif mt-3">{selectedDayEntries.some((entry) => entry.hasContent) ? "Complete" : "Empty"}</div>
                <p className="text-sm text-fg-muted mt-2">A day has activity when at least one My Day task is linked.</p>
              </div>
            </aside>
          </div>
        </div>
      )}

      {activeTab === "week" && (
        <section className="border border-line bg-surface-panel">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line p-4">
            <div><h2 className="text-xl">Daily tasks</h2><p className="mt-1 text-sm text-fg-muted">{formatDate(rangeStart, { month: "long", day: "numeric", year: "numeric" })}–{formatDate(rangeEnd, { month: "long", day: "numeric", year: "numeric" })} · {member?.name || "Team member"}</p></div>
            <span className="text-xs text-fg-muted">{entries.filter((entry) => entry.member.id === member?.id && entry.date >= rangeStart && entry.date <= rangeEnd && entry.hasContent).length} days with tasks</span>
          </div>
          <div className="divide-y divide-line">
            {entries.filter((entry) => entry.member.id === member?.id && entry.date >= rangeStart && entry.date <= rangeEnd && entry.hasContent).sort((a, b) => b.date.localeCompare(a.date)).map((entry) => (
              <article key={entry.id} className="grid gap-3 p-4 md:grid-cols-[180px_1fr]">
                <div><h3 className="font-semibold text-sm text-fg">{formatDate(entry.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</h3><button type="button" onClick={() => { if (hideViewTabs && onOpenDay) onOpenDay(entry.date); else { setSelectedDate(entry.date); setActiveTab("today"); } }} className="mt-2 text-xs font-semibold text-fg-secondary hover:text-fg">Open this day →</button></div>
                <div>
                  {entry.dailyTasks?.length ? <ul className="divide-y divide-line">
                    {entry.dailyTasks.map((task) => <li key={task.id} className="py-2 text-sm text-fg">
                      <div className={`font-medium ${task.completed ? "line-through text-fg-muted" : ""}`}>{task.name}</div>
                      {task.description && <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-fg-muted">{task.description}</p>}
                    </li>)}
                  </ul> : <p className="text-sm text-fg-muted">No My Day tasks are linked to this date.</p>}
                </div>              </article>
            ))}
            {!entries.some((entry) => entry.member.id === member?.id && entry.date >= rangeStart && entry.date <= rangeEnd && entry.hasContent) && <p className="p-8 text-center text-sm text-fg-muted">No activity recorded in this period.</p>}
          </div>
        </section>
      )}

      {activeTab === "insights" && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl">{formatDate(rangeStart, { month: "long", day: "numeric", year: "numeric" })}–{formatDate(rangeEnd, { month: "long", day: "numeric", year: "numeric" })}</h2>
            <p className="text-sm text-fg-muted mt-1">{insightMemberId === "all" ? "All team members" : (payload?.members.find((person) => person.id === insightMemberId)?.name || "Selected member")} · weekends and future dates are excluded from completeness.</p>
          </div>

          <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
            <div className="bg-surface-panel border border-line p-5"><div className="text-xs uppercase tracking-wider font-bold text-fg-muted">Team completeness</div><div className="text-3xl font-serif font-bold text-fg mt-2">{averageCompleteness}%</div><div className="text-xs text-fg-muted mt-1">{submittedLogs} of {expectedLogs} expected logs</div></div>
            <div className="bg-surface-panel border border-line p-5"><div className="text-xs uppercase tracking-wider font-bold text-fg-muted">Members tracked</div><div className="text-3xl font-serif font-bold text-fg mt-2">{filteredRows.length}</div><div className="text-xs text-fg-muted mt-1">within the selected view</div></div>
            <div className="bg-surface-panel border border-line p-5"><div className="text-xs uppercase tracking-wider font-bold text-fg-muted">Empty logs</div><div className="text-3xl font-serif font-bold text-warning-fg mt-2">{emptyDayLogs}</div><div className="text-xs text-fg-muted mt-1">no daily record found</div></div>
          </div>

          <section className="bg-surface-panel border border-line">
            <div className="p-5 border-b border-line flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div><h3 className="text-lg flex items-center gap-2"><Users size={18} className="text-link" /> Completeness by team member</h3><p className="text-sm text-fg-muted mt-1">Submitted logs compared with elapsed working days.</p></div>
              <div className="text-xs text-fg-muted">Expected per member: <strong className="text-fg">{workdays.length} days</strong></div>
            </div>
            <div className="divide-y divide-line">
              {filteredRows.map((row) => (
                <div key={row.member.id} className="p-4 md:p-5 grid grid-cols-1 md:grid-cols-[minmax(190px,1fr)_minmax(220px,2fr)_100px] gap-4 items-center">
                  <div className="flex items-center gap-3 min-w-0"><MemberAvatar member={row.member} /><div className="min-w-0"><div className="text-sm font-semibold text-fg truncate">{row.member.name}</div><div className="text-xs text-fg-muted">{row.submittedDates.length} submitted · {row.emptyDays.length} empty logs</div></div></div>
                  <div>
                    <div className="h-2.5 bg-surface-panel overflow-hidden flex" role="progressbar" aria-label={`${row.member.name} completeness`} aria-valuenow={row.percent} aria-valuemin={0} aria-valuemax={100}>
                      <span className="bg-action h-full" style={{ width: `${row.percent}%` }} />
                    </div>
                  </div>
                  <div className="md:text-right"><span className={`text-2xl font-serif font-bold ${row.percent >= 90 ? "text-success-fg" : row.percent >= 70 ? "text-warning-fg" : "text-danger-fg"}`}>{row.percent}%</span></div>
                </div>
              ))}
              {!displayedRows.length && <div className="p-8 text-center text-sm text-fg-muted">No team members were found in this list.</div>}
            </div>
          </section>

          <section className="bg-surface-panel border border-line">
            <div className="p-5 border-b border-line flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div><h3 className="text-lg flex items-center gap-2"><CalendarDays size={18} className="text-link" /> Coverage by workday</h3><p className="text-sm text-fg-muted mt-1">A daily audit of submitted logs and days without any logs.</p></div>
              <div className="flex items-center gap-4 text-xs text-fg-muted"><span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 bg-success-action" /> Submitted</span><span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 bg-warning-surface border border-warning-border" /> Empty log</span></div>
            </div>
            <div className="overflow-x-auto p-5">
              <div style={{ minWidth: `${Math.max(720, 210 + workdays.length * 35)}px` }}>
                <div className="grid gap-1.5 items-end mb-2" style={{ gridTemplateColumns: `190px repeat(${workdays.length}, minmax(28px, 1fr))` }}>
                  <div className="text-xs uppercase tracking-wider font-bold text-fg-muted">Team member</div>
                  {workdays.map((date) => <div key={date} className="text-center"><div className="text-[11px] uppercase text-fg-muted">{formatDate(date, { weekday: "narrow" })}</div><div className="text-xs font-bold text-fg">{fromIso(date).getDate()}</div></div>)}
                </div>
                <div className="space-y-1.5">
                  {filteredRows.map((row) => (
                    <div key={row.member.id} className="grid gap-1.5 items-center" style={{ gridTemplateColumns: `190px repeat(${workdays.length}, minmax(28px, 1fr))` }}>
                      <div className="text-sm font-semibold text-fg truncate pr-3">{row.member.name}</div>
                      {workdays.map((date) => {
                        const dayEntries = row.byDate.get(date) || [];
                        const status = dayEntries.some((entry) => entry.hasContent) ? "submitted" : "empty";
                        return <div key={date} title={`${formatDate(date)}: ${status === "submitted" ? "submitted" : "empty log"}`} aria-label={`${row.member.name}, ${formatDate(date)}: ${status === "submitted" ? "submitted" : "empty log"}`} className={`h-8 grid place-items-center text-xs font-bold ${status === "submitted" ? "bg-success-action text-on-action" : "bg-warning-surface text-warning-fg border border-warning-border"}`}>{status === "submitted" ? "✓" : "·"}</div>;
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>


        </div>
      )}
    </div>
  );
}
