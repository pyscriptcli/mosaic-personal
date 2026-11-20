"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlignCenter, AlignLeft, AlignRight, AlertCircle, Bold, Bell, BellOff, BookOpen, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, GripVertical, Highlighter, Italic, Link2, List, ListOrdered, LoaderCircle, Pencil, Plus, Quote, Redo2, RefreshCw, Save, Sparkles, Trash2, Underline, Undo2, X } from "lucide-react";
import { getStoredClickUpListId, getStoredClickUpToken } from "@/lib/api";
import { requestCentralClickUpSync, trackClickUpLiveRefresh } from "@/lib/clickupSyncClient";
import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";
import type { NotebookActivityHistory } from "@/features/notebook/pages/NotebookView";
import { useEchoAI } from "@/features/ask-echo/components/EchoAI";
import { orderNotebookTasks } from "@/features/notebook/lib/notebookTaskOrdering";

type DayTask = {
  id: string; name: string; description: string; status: string; completed: boolean;
  priority?: "urgent" | "high" | "normal" | "low" | "none" | null; dueDate: string; url: string; listId?: string; notebookDate?: string; createdDate?: string; completedDate?: string | null; carriedForward?: boolean;
};
type ReminderTask = Pick<DayTask, "id" | "name" | "description" | "priority" | "dueDate" | "url"> & { overdue: boolean; notebookDate: string };
type NotebookList = { id: string; name: string };
type AiTaskDraft = { id: string; name: string; description: string; dueDate: string; priority: "high" | "none"; selected: boolean };
type DailyActivity = { client: string; admin: string; adhoc: string; meetings: string };
type DayPayload = {
  date: string; dayTask: { id: string; name: string; url: string } | null; tasks: DayTask[];
  taskOrder?: string[];
  notes: string; noteTask: { id: string; name: string; url: string } | null; activity: DailyActivity;
  personalList: { id: string; name: string } | null; completeStatus: string; openStatus: string; notesError?: string;
  isFresh?: boolean;
  dailyLogByDate?: Array<{ date: string; dayTask: { id: string; name: string; url: string }; activity: DailyActivity }>;
};
type Props = { userId?: string; currentUserName?: string; showDailyActivity?: boolean; activityOnly?: boolean; resizableWorkspace?: boolean; initialDate?: string; onDateChange?: (date: string) => void; activityHistory?: NotebookActivityHistory | null; enableNotebookLists?: boolean; notebookStatus?: "todo" | "done"; onAddTask?: () => void; notebookDateControlsTarget?: HTMLElement | null };

const todayIso = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const moveDate = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const reminderDateLabel = (value: string) => {
  const date = new Date(`${value}T12:00:00`);
  return `${date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · ${date.toLocaleDateString("en-US", { weekday: "long" })}`;
};
const REMINDER_KEY = "project_echo_my_day_reminders.v2";
const LEGACY_REMINDER_KEY = "project_echo_my_day_reminders";
const NOTEBOOK_SPLIT_KEY = "mosaic.notebook.pane-split.v1";
const SPLITTER_WIDTH = 20;
const DEFAULT_TASK_PANE_RATIO = 50;

function getPaneSplitBounds(width: number) {
  if (width < 600) return null;
  return { min: 15, max: 85 };
}
const EMPTY_TASKS: DayTask[] = [];
const ACTIVITY_FIELDS: Array<{ key: keyof DailyActivity; label: string }> = [
  { key: "client", label: "Client" },
  { key: "admin", label: "Admin" },
  { key: "adhoc", label: "Ad hoc" },
  { key: "meetings", label: "Meetings" },
];
const EMPTY_ACTIVITY: DailyActivity = { client: "", admin: "", adhoc: "", meetings: "" };

function escapeNotesHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

const RICH_NOTES_PREFIX = "mosaic-rich-notes:v1\n";
const ALLOWED_NOTES_TAGS = new Set(["a", "blockquote", "br", "div", "em", "i", "li", "mark", "ol", "p", "small", "span", "strong", "u", "ul"]);

function sanitizeNotesHtml(value: string) {
  const documentValue = new DOMParser().parseFromString(value, "text/html");
  const serialize = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeNotesHtml(node.textContent || "");
    if (!(node instanceof HTMLElement)) return "";
    const tag = node.tagName.toLowerCase();
    if (["script", "style", "iframe", "object", "svg", "math"].includes(tag)) return "";
    const contents = Array.from(node.childNodes, serialize).join("");
    if (!ALLOWED_NOTES_TAGS.has(tag)) return contents;
    const attributes: string[] = [];
    if (tag === "a") {
      const href = node.getAttribute("href") || "";
      if (/^(https?:\/\/|mailto:)/i.test(href)) attributes.push(`href="${escapeNotesHtml(href)}"`);
    }
    const styles: string[] = [];
    const align = node.style.textAlign.toLowerCase();
    if (["left", "center", "right"].includes(align)) styles.push(`text-align:${align}`);
    const fontSize = node.style.fontSize.match(/^(\d{1,2})(px|pt)$/i);
    if (fontSize) styles.push(`font-size:${fontSize[1]}${fontSize[2].toLowerCase()}`);
    if (styles.length) attributes.push(`style="${styles.join(";")}"`);
    if (tag === "br") return `<br${attributes.length ? ` ${attributes.join(" ")}` : ""}>`;
    return `<${tag}${attributes.length ? ` ${attributes.join(" ")}` : ""}>${contents}</${tag}>`;
  };
  return Array.from(documentValue.body.childNodes, serialize).join("");
}

function notesMarkdownToHtml(value: string) {
  if (value.startsWith(RICH_NOTES_PREFIX)) return sanitizeNotesHtml(value.slice(RICH_NOTES_PREFIX.length));
  const inline = (text: string) => escapeNotesHtml(text)
    .replace(/&lt;(\/?)(u|mark|small)&gt;/gi, "<$1$2>")
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/gi, '<a href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>");
  const lines = value.split(/\r?\n/);
  const blocks: string[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index] === "") { blocks.push("<div><br></div>"); index += 1; continue; }
    if (/^\s*[-*]\s+/.test(lines[index])) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) items.push(`<li>${inline(lines[index++].replace(/^\s*[-*]\s+/, ""))}</li>`);
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(lines[index])) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) items.push(`<li>${inline(lines[index++].replace(/^\s*\d+[.)]\s+/, ""))}</li>`);
      blocks.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    if (/^\s*>\s?/.test(lines[index])) {
      const quoted: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) quoted.push(`<div>${inline(lines[index++].replace(/^\s*>\s?/, ""))}</div>`);
      blocks.push(`<blockquote>${quoted.join("")}</blockquote>`);
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index] !== "" && !/^\s*(?:[-*]\s+|\d+[.)]\s+|>\s?)/.test(lines[index])) paragraph.push(lines[index++]);
    blocks.push(`<div>${paragraph.map(inline).join("<br>")}</div>`);
  }
  return blocks.join("");
}

function notesHtmlToMarkdown(root: HTMLElement) {
  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (!(node instanceof HTMLElement)) return "";
    if (node.tagName === "BR") return "\n";
    const content = Array.from(node.childNodes, inline).join("");
    if (node.tagName === "STRONG" || node.tagName === "B") return `**${content}**`;
    if (node.tagName === "EM" || node.tagName === "I") return `_${content}_`;
    if (node.tagName === "U") return `<u>${content}</u>`;
    if (node.tagName === "MARK" || node.style.backgroundColor) return `<mark>${content}</mark>`;
    if (node.tagName === "SMALL" || (node.tagName === "FONT" && node.getAttribute("size") === "2")) return `<small>${content}</small>`;
    if (node.tagName === "A") return `[${content}](${node.getAttribute("href") || ""})`;
    return content;
  };
  const blocks = Array.from(root.childNodes).map((node) => {
    if (node instanceof HTMLElement && (node.tagName === "UL" || node.tagName === "OL")) {
      const ordered = node.tagName === "OL";
      return Array.from(node.children).filter((item) => item.tagName === "LI").map((item, index) => `${ordered ? `${index + 1}.` : "-"} ${inline(item)}`).join("\n");
    }
    if (node instanceof HTMLElement && node.tagName === "BLOCKQUOTE") return inline(node).split("\n").map((line) => line ? `> ${line}` : ">").join("\n");
    return inline(node);
  });
  return blocks.join("\n");
}

function requestHeaders(personalList?: { id: string; name: string } | null) {
  const headers = new Headers({ "Content-Type": "application/json" });
  const token = getStoredClickUpToken();
  const listId = getStoredClickUpListId();
  if (token) headers.set("x-clickup-token", token);
  if (listId) headers.set("x-clickup-list-id", listId);
  if (personalList?.id) {
    headers.set("x-personal-list-id", personalList.id);
    headers.set("x-personal-list-name", personalList.name);
  }
  return headers;
}

export default function MyDayView({ userId, currentUserName, showDailyActivity = true, activityOnly = false, resizableWorkspace = false, initialDate, onDateChange, activityHistory, enableNotebookLists = false, notebookStatus = "todo", onAddTask, notebookDateControlsTarget }: Props) {
  const { runStructured, isWorking } = useEchoAI();
  const [date, setDate] = useState(() => initialDate || todayIso());
  const [payload, setPayload] = useState<DayPayload | null>(null);
  const [optimisticTasks, setOptimisticTasks] = useState<DayTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(todayIso);
  const [priority, setPriority] = useState<NonNullable<DayTask["priority"]>>("normal");
  const [savingTask, setSavingTask] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [dropTargetTaskId, setDropTargetTaskId] = useState("");
  const [editDraft, setEditDraft] = useState<Partial<DayTask>>({});
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSave, setNoteSave] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const [noteError, setNoteError] = useState("");
  const [activityDraft, setActivityDraft] = useState<DailyActivity>(EMPTY_ACTIVITY);
  const [activitySave, setActivitySave] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const [activityError, setActivityError] = useState("");
  const [taskPaneRatio, setTaskPaneRatio] = useState(DEFAULT_TASK_PANE_RATIO);
  const [workspaceWidth, setWorkspaceWidth] = useState<number | null>(null);
  const [narrowPane, setNarrowPane] = useState<"tasks" | "notes">("tasks");
  const workspaceRef = useRef<HTMLDivElement>(null);
  const taskPaneRatioRef = useRef(DEFAULT_TASK_PANE_RATIO);
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [reminderTasks, setReminderTasks] = useState<ReminderTask[]>([]);
  const [reminderHours, setReminderHours] = useState("00");
  const [reminderMinutes, setReminderMinutes] = useState("30");
  const [reminderSeconds, setReminderSeconds] = useState("00");
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderSettingsOpen, setReminderSettingsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [settingsReady, setSettingsReady] = useState(false);
  const [personalList, setPersonalList] = useState<DayPayload["personalList"]>(null);
  const [notebookLists, setNotebookLists] = useState<NotebookList[]>([{ id: "my-tasks", name: "My Tasks" }]);
  const [selectedNotebookList, setSelectedNotebookList] = useState("my-tasks");
  const [personalListLoading, setPersonalListLoading] = useState(true);
  const [personalListInput, setPersonalListInput] = useState("");
  const [personalListError, setPersonalListError] = useState("");
  const [validatingPersonalList, setValidatingPersonalList] = useState(false);
  const [taskSummary, setTaskSummary] = useState("");
  const [summaryState, setSummaryState] = useState<"idle" | "loading" | "error">("idle");
  const [summaryError, setSummaryError] = useState("");
  const [notesSize, setNotesSize] = useState("16");
  const [notesAiOpen, setNotesAiOpen] = useState(false);
  const [notesAiPrompt, setNotesAiPrompt] = useState("");
  const [notesAiDraft, setNotesAiDraft] = useState("");
  const [notesAiState, setNotesAiState] = useState<"idle" | "loading" | "preview" | "error">("idle");
  const [notesAiError, setNotesAiError] = useState("");
  const [taskAiOpen, setTaskAiOpen] = useState(false);
  const [taskAiPrompt, setTaskAiPrompt] = useState("");
  const [taskAiDrafts, setTaskAiDrafts] = useState<AiTaskDraft[]>([]);
  const [taskAiState, setTaskAiState] = useState<"idle" | "loading" | "preview" | "saving" | "error">("idle");
  const [taskAiError, setTaskAiError] = useState("");
  const notesEditor = useRef<HTMLDivElement>(null);
  const notesSelection = useRef<Range | null>(null);
  const reminderDialog = useRef<HTMLElement>(null);
  const allTasks = useMemo(() => {
    const loadedTasks = payload?.tasks ?? EMPTY_TASKS;
    const loadedIds = new Set(loadedTasks.map((task) => task.id));
    const combined = [...optimisticTasks.filter((task) => !loadedIds.has(task.id)), ...loadedTasks];
    return enableNotebookLists ? orderNotebookTasks(combined, payload?.taskOrder) : combined;
  }, [enableNotebookLists, optimisticTasks, payload?.taskOrder, payload?.tasks]);
  const tasks = useMemo(() => enableNotebookLists ? allTasks.filter((task) => task.completed === (notebookStatus === "done")) : allTasks, [allTasks, enableNotebookLists, notebookStatus]);
  const reminderIntervalSeconds = Math.max(1, Number(reminderHours || 0) * 3600 + Number(reminderMinutes || 0) * 60 + Number(reminderSeconds || 0));
  const lastReminderAt = useRef(0);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dayRequestVersion = useRef(0);
  const dayPayloadCache = useRef(new Map<string, { payload: DayPayload; cachedAt: number }>());
  const notesReady = useRef(false);
  const activityReady = useRef(false);

  const getActivityHistoryDay = useCallback((requestedDate: string): DayPayload | null => {
    if (!activityOnly || !activityHistory?.isCurrentUser || requestedDate < activityHistory.start || requestedDate > activityHistory.end) return null;
    const entry = activityHistory.entries.find((item) => item.date === requestedDate && (
      item.member.id === String(userId || "") || item.member.name.trim().toLowerCase() === String(currentUserName || "").trim().toLowerCase()
    )) || activityHistory.entries.find((item) => item.date === requestedDate);
    return {
      date: requestedDate,
      dayTask: entry ? { id: entry.id, name: entry.name, url: entry.url } : null,
      tasks: [], notes: "", noteTask: null, activity: entry?.categories || EMPTY_ACTIVITY,
      personalList: null, completeStatus: "complete", openStatus: "to do", isFresh: activityHistory.isFresh,
    };
  }, [activityHistory, activityOnly, currentUserName, userId]);

  const changeDate = useCallback((nextDate: string, notifyParent = true) => {
    if (!nextDate || nextDate === date) return;
    dayRequestVersion.current += 1;
    setDate(nextDate);
    if (notifyParent) onDateChange?.(nextDate);
    setError("");
    if (!activityOnly) return;

    const historyDay = getActivityHistoryDay(nextDate);
    if (historyDay) {
      dayPayloadCache.current.set(`${nextDate}:${personalList?.id || "default"}`, { payload: historyDay, cachedAt: Date.now() });
      setPayload(historyDay);
      setActivityDraft(historyDay.activity);
      setActivitySave("saved");
      setActivityError("");
      activityReady.current = true;
      setLoading(false);
      setRefreshing(false);
    } else {
      activityReady.current = false;
      setActivityDraft(EMPTY_ACTIVITY);
      setActivitySave("saved");
      setLoading(true);
    }
  }, [activityOnly, date, getActivityHistoryDay, onDateChange, personalList?.id]);

  useEffect(() => {
    if (!initialDate || initialDate === date) return;
    const frame = window.requestAnimationFrame(() => changeDate(initialDate, false));
    return () => window.cancelAnimationFrame(frame);
  }, [changeDate, date, initialDate]);

  useEffect(() => {
    if (!enableNotebookLists) return;
    let active = true;
    const loadLists = () => {
      void fetch("/api/my-day?lists=1", { cache: "no-store" }).then((response) => response.json()).then((body) => {
        if (!active || !Array.isArray(body.lists)) return;
        setNotebookLists(body.lists);
        setSelectedNotebookList((current) => body.lists.some((list: NotebookList) => list.id === current) ? current : "my-tasks");
      }).catch(() => undefined);
    };
    loadLists();
    window.addEventListener("mosaic-notebook-lists-changed", loadLists);
    return () => { active = false; window.removeEventListener("mosaic-notebook-lists-changed", loadLists); };
  }, [enableNotebookLists]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const current = JSON.parse(localStorage.getItem(REMINDER_KEY) || "null");
        const legacy = JSON.parse(localStorage.getItem(LEGACY_REMINDER_KEY) || "{}");
        const stored = current && typeof current === "object" ? current : { ...legacy, enabled: false };
        setRemindersEnabled(stored.enabled === true);
        const storedSeconds = Number.isFinite(Number(stored.intervalSeconds))
          ? Math.max(1, Math.min(359999, Number(stored.intervalSeconds)))
          : Math.max(300, Math.min(14400, Number(stored.minutes) * 60 || 1800));
        setReminderHours(String(Math.floor(storedSeconds / 3600)).padStart(2, "0"));
        setReminderMinutes(String(Math.floor((storedSeconds % 3600) / 60)).padStart(2, "0"));
        setReminderSeconds(String(storedSeconds % 60).padStart(2, "0"));
      } catch { /* use defaults */ }
      setPersonalList({
        id: localStorage.getItem("project_echo_personal_list_id") || "",
        name: localStorage.getItem("project_echo_personal_list_name") || "Personal List",
      });
      lastReminderAt.current = Date.now();
      setSettingsReady(true);
      if (enableNotebookLists) {
        setPersonalList({ id: "local", name: "This device" });
        setPersonalListLoading(false);
        return;
      }
      void fetch("/api/user/preferences", { cache: "no-store" }).then((response) => response.json()).then((body) => {
        const prefs = body.preferences;
        if (prefs?.personal_list_id) {
          const list = { id: String(prefs.personal_list_id), name: String(prefs.personal_list_name || "Personal List") };
          localStorage.setItem("project_echo_personal_list_id", list.id);
          localStorage.setItem("project_echo_personal_list_name", list.name);
          setPersonalList(list);
        }
      }).catch(() => undefined).finally(() => setPersonalListLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [enableNotebookLists]);

  const loadDay = useCallback(async (background = false) => {
    const requestVersion = ++dayRequestVersion.current;
    const requestedDate = date;
    const cacheKey = `${requestedDate}:${personalList?.id || "default"}`;
    const cached = dayPayloadCache.current.get(cacheKey);
    const applyDay = (body: DayPayload) => {
      setPayload(body);
      setOptimisticTasks((current) => current.filter((task) => !body.tasks?.some((loaded) => loaded.id === task.id)));
      setPersonalList(body.personalList || null);
      setPersonalListLoading(false);
      setNoteDraft(body.notes || "");
      if (notesEditor.current && document.activeElement !== notesEditor.current) notesEditor.current.innerHTML = notesMarkdownToHtml(body.notes || "");
      setNoteSave("saved");
      setNoteError(body.notesError || "");
      setActivityDraft(body.activity || EMPTY_ACTIVITY);
      setActivitySave("saved");
      setActivityError("");
      activityReady.current = true;
      notesReady.current = true;
    };
    if (activityOnly && !background && activityHistory === undefined) return;
    const fromHistory = getActivityHistoryDay(requestedDate);
    if (fromHistory) {
      dayPayloadCache.current.set(cacheKey, { payload: fromHistory, cachedAt: Date.now() });
      applyDay(fromHistory);
      setError("");
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (!background && cached && Date.now() - cached.cachedAt < (activityOnly ? 5 * 60_000 : 20_000)) {
      if (!activityOnly) {
        applyDay(cached.payload);
        setError("");
        setLoading(false);
        return;
      }
      applyDay({ ...cached.payload, isFresh: false });
    }
    if (!background) activityReady.current = false;
    if (background) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const localParams = enableNotebookLists ? "" : `&personalListId=${encodeURIComponent(personalList?.id || "")}&personalListName=${encodeURIComponent(personalList?.name || "Personal List")}`;
      const response = await fetch(`/api/my-day?date=${encodeURIComponent(requestedDate)}${localParams}${activityOnly ? "&includeNotes=0" : ""}${background || activityOnly ? "&liveRefresh=1" : ""}`, { headers: enableNotebookLists ? undefined : requestHeaders(personalList), cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "My Day could not be loaded.");
      if (requestVersion !== dayRequestVersion.current) return;
      if (body.date !== requestedDate) throw new Error(enableNotebookLists ? "Notebook returned a different day than the one requested." : "ClickUp returned a different day than the one requested.");
      const loaded = body as DayPayload;
      const cachedAt = Date.now();
      dayPayloadCache.current.set(cacheKey, { payload: loaded, cachedAt });
      if (activityOnly) {
        for (const entry of loaded.dailyLogByDate || []) {
          const dayPayload: DayPayload = {
            ...loaded, date: entry.date, dayTask: entry.dayTask, tasks: [], notes: "", noteTask: null,
            activity: entry.activity, dailyLogByDate: undefined,
          };
          dayPayloadCache.current.set(`${entry.date}:${personalList?.id || "default"}`, { payload: dayPayload, cachedAt });
        }
      }
      if (dayPayloadCache.current.size > 64) {
        const oldestKey = dayPayloadCache.current.keys().next().value;
        if (oldestKey) dayPayloadCache.current.delete(oldestKey);
      }
      applyDay(loaded);
    } catch (loadError) {
      if (requestVersion !== dayRequestVersion.current) return;
      setPersonalListLoading(false);
      setError(loadError instanceof Error ? loadError.message : "My Day could not be loaded.");
      if (background) throw loadError;
    } finally {
      if (requestVersion === dayRequestVersion.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [activityHistory, activityOnly, date, enableNotebookLists, getActivityHistoryDay, personalList]);

  useEffect(() => {
    const timer = window.setTimeout(() => { notesReady.current = false; void loadDay(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDay]);

  useEffect(() => {
    const refreshAfterSync = (event: Event) => {
      trackClickUpLiveRefresh(event, () => activityOnly && activityHistory?.isCurrentUser ? Promise.resolve() : loadDay(true), activityOnly ? "Daily Log" : "My Day");
    };
    window.addEventListener("mosaic-clickup-sync-complete", refreshAfterSync);
    return () => window.removeEventListener("mosaic-clickup-sync-complete", refreshAfterSync);
  }, [activityHistory?.isCurrentUser, activityOnly, loadDay]);

  useEffect(() => {
    if (!enableNotebookLists) return;
    const refresh = () => { dayPayloadCache.current.clear(); void loadDay(true); };
    window.addEventListener("mosaic-notebook-tasks-changed", refresh);
    return () => window.removeEventListener("mosaic-notebook-tasks-changed", refresh);
  }, [enableNotebookLists, loadDay]);

  const requestDayRefresh = async () => {
    setRefreshing(true);
    setError("");
    try {
      await requestCentralClickUpSync();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Unable to start ClickUp sync.");
      setRefreshing(false);
    }
  };

  const send = useCallback(async (body: Record<string, unknown>) => {
    const requestedDate = typeof body.date === "string" ? body.date : date;
    const response = await fetch("/api/my-day", {
      method: "POST",
      headers: requestHeaders(personalList),
      body: JSON.stringify({ ...body, date: requestedDate }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "ClickUp could not save this change.");
    return result;
  }, [date, personalList]);

  const configurePersonalList = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!personalListInput.trim()) return;
    setValidatingPersonalList(true);
    setPersonalListError("");
    try {
      const response = await fetch("/api/clickup/validate-list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: personalListInput.trim() }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.valid || !result.list?.id) throw new Error(result.error || "Choose a list you can access.");
      const selected = { id: String(result.list.id), name: String(result.list.name || "Personal List") };
      const existingResponse = await fetch("/api/user/preferences", { cache: "no-store" });
      const existingBody = await existingResponse.json().catch(() => ({}));
      const preferences = existingBody.preferences && typeof existingBody.preferences === "object" ? existingBody.preferences : {};
      const saved = await fetch("/api/user/preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferences: { ...preferences, personal_list_id: selected.id, personal_list_name: selected.name } }) });
      if (!saved.ok) throw new Error("The list was checked but your preference could not be saved.");
      localStorage.setItem("project_echo_personal_list_id", selected.id);
      localStorage.setItem("project_echo_personal_list_name", selected.name);
      setPersonalList(selected);
      setPayload((current) => current ? { ...current, personalList: selected } : current);
      setPersonalListInput("");
    } catch (error) {
      setPersonalListError(error instanceof Error ? error.message : "The Personal List could not be saved.");
    } finally {
      setValidatingPersonalList(false);
    }
  };

  const handleNotesInput = () => {
    const editor = notesEditor.current;
    if (!editor) return;
    setNoteDraft(enableNotebookLists ? `${RICH_NOTES_PREFIX}${sanitizeNotesHtml(editor.innerHTML)}` : notesHtmlToMarkdown(editor));
  };

  const generateNotesDraft = async () => {
    setNotesAiState("loading");
    setNotesAiError("");
    try {
      const existingNotes = notesEditor.current?.innerText || payload?.notes || "";
      const result = await runStructured<{ draft: string }>(
        `Draft notes for ${dateLabel(date)} from the user's instruction. Return JSON with a single draft string. Keep facts from the provided day context, preserve names and dates, and do not add facts. User instruction: ${notesAiPrompt.trim() || "Improve and organize the existing notes while preserving all meaning."}`,
        JSON.stringify({ date, existingNotes, tasks: allTasks.map(({ name, description, completed, dueDate, priority }) => ({ name, description, completed, dueDate, priority })) }),
      );
      const draft = String(result.draft || "").trim();
      if (!draft) throw new Error("Codex returned an empty notes draft.");
      setNotesAiDraft(draft);
      setNotesAiState("preview");
    } catch (generationError) {
      setNotesAiError(generationError instanceof Error ? generationError.message : "Notes could not be generated.");
      setNotesAiState("error");
    }
  };

  const applyNotesDraft = (mode: "replace" | "append") => {
    const editor = notesEditor.current;
    if (!editor || !notesAiDraft) return;
    if (mode === "replace") editor.textContent = notesAiDraft;
    else editor.append(document.createTextNode(`${editor.innerText.trim() ? "\n\n" : ""}${notesAiDraft}`));
    handleNotesInput();
    setNotesAiOpen(false);
    setNotesAiState("idle");
    setNotesAiPrompt("");
    setNotesAiDraft("");
  };

  const generateTaskDrafts = async () => {
    setTaskAiState("loading");
    setTaskAiError("");
    try {
      const result = await runStructured<{ tasks: Array<{ name?: string; description?: string; dueDate?: string | null; priority?: string }> }>(
        `Create a short list of actionable task suggestions for ${dateLabel(date)} from the user's instruction. Return JSON shaped as {"tasks":[{"name":"...","description":"...","dueDate":null,"priority":"high|none"}]}. Use dueDate only as YYYY-MM-DD. Do not create tasks or make changes. User instruction: ${taskAiPrompt.trim() || "Suggest the next actionable tasks from the day's notes and incomplete tasks."}`,
        JSON.stringify({ date, notes: notesEditor.current?.innerText || payload?.notes || "", tasks: allTasks.map(({ name, description, completed, dueDate, priority }) => ({ name, description, completed, dueDate, priority })) }),
      );
      const suggestions = (Array.isArray(result.tasks) ? result.tasks : []).map((task, index) => ({
        id: `ai-${Date.now()}-${index}`,
        name: String(task.name || "").trim().slice(0, 300),
        description: String(task.description || "").trim().slice(0, 4000),
        dueDate: typeof task.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) ? task.dueDate : "",
        priority: String(task.priority || "").toLowerCase() === "high" ? "high" as const : "none" as const,
        selected: true,
      })).filter((task) => task.name);
      if (!suggestions.length) throw new Error("Codex returned no usable task suggestions.");
      setTaskAiDrafts(suggestions);
      setTaskAiState("preview");
    } catch (generationError) {
      setTaskAiError(generationError instanceof Error ? generationError.message : "Task suggestions could not be generated.");
      setTaskAiState("error");
    }
  };

  const saveSelectedAiTasks = async () => {
    const selected = taskAiDrafts.filter((task) => task.selected);
    if (!selected.length) { setTaskAiError("Select at least one task to add."); return; }
    setTaskAiState("saving");
    setTaskAiError("");
    const savedIds = new Set<string>();
    try {
      for (const task of selected) {
        const result = await send({ action: "create", date, name: task.name, description: task.description, dueDate: task.dueDate, priority: task.priority, listId: selectedNotebookList });
        if (!result.task || typeof result.task !== "object") throw new Error(`Task saved without a task record: ${task.name}`);
        const createdTask = result.task as DayTask;
        savedIds.add(task.id);
        setOptimisticTasks((current) => [createdTask, ...current.filter((entry) => entry.id !== createdTask.id)]);
        setPayload((current) => current ? { ...current, dayTask: result.dayTask || current.dayTask, tasks: [createdTask, ...current.tasks.filter((entry) => entry.id !== createdTask.id)] } : current);
      }
      const remaining = taskAiDrafts.filter((task) => !savedIds.has(task.id));
      setTaskAiDrafts(remaining);
      setTaskAiState(remaining.length ? "preview" : "idle");
      if (!remaining.length) { setTaskAiOpen(false); setTaskAiPrompt(""); }
    } catch (saveError) {
      setTaskAiDrafts((current) => current.filter((task) => !savedIds.has(task.id)));
      setTaskAiState("error");
      setTaskAiError(saveError instanceof Error ? saveError.message : "Some tasks could not be saved.");
    }
  };

  const rememberNotesSelection = () => {
    const editor = notesEditor.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount || !editor.contains(selection.anchorNode)) return;
    notesSelection.current = selection.getRangeAt(0).cloneRange();
  };

  const formatNotes = (command: string, value?: string) => {
    const editor = notesEditor.current;
    if (!editor) return;
    if (document.activeElement !== editor && notesSelection.current && editor.contains(notesSelection.current.commonAncestorContainer)) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(notesSelection.current);
    }
    editor.focus();
    if (command === "fontSize" && value) {
      document.execCommand(command, false, "7");
      editor.querySelectorAll('font[size="7"]').forEach((font) => {
        const span = document.createElement("span");
        span.style.fontSize = `${value}px`;
        while (font.firstChild) span.appendChild(font.firstChild);
        font.replaceWith(span);
      });
    } else if (command === "createLink" && value) {
      const href = /^(https?:\/\/|mailto:)/i.test(value) ? value : `https://${value}`;
      if (!/^https?:\/\/|^mailto:/i.test(href)) return;
      document.execCommand(command, false, href);
    } else {
      document.execCommand(command, false, value);
    }
    handleNotesInput();
    rememberNotesSelection();
  };

  const generateSummary = useCallback(async () => {
    if (!tasks.length) { setTaskSummary(""); return; }
    setSummaryState("loading");
    setSummaryError("");
    try {
      const result = await runStructured<{ summary: string }>(
        'Summarize the user\'s My Day tasks as a short factual bullet list. Distinguish completed work from pending work. Do not invent progress or due dates. Return JSON with a summary string.',
        JSON.stringify(tasks.map(({ id, name, description, status, completed, dueDate }) => ({ id, name, description, status, completed, dueDate }))),
      );
      const summary = String(result.summary || "").trim();
      setTaskSummary(summary);
      if (summary) {
        setActivityDraft((current) => { const marker = "My Day summary"; const markerIndex = current.adhoc.lastIndexOf(marker); const base = (markerIndex >= 0 ? current.adhoc.slice(0, markerIndex) : current.adhoc).trim(); return { ...current, adhoc: `${base ? `${base}\n\n` : ""}${marker}\n${summary}` }; });
      }
      setSummaryState("idle");
    } catch (error) {
      setSummaryState("error");
      setSummaryError(error instanceof Error ? error.message : "A task summary could not be generated.");
    }
  }, [runStructured, tasks]);

  useEffect(() => {
    if (!notesReady.current || personalListLoading || noteDraft === (payload?.notes || "")) return;
    if (notesTimer.current) clearTimeout(notesTimer.current);
    setNoteSave("pending");
    notesTimer.current = setTimeout(async () => {
      setNoteSave("saving");
      setNoteError("");
      try {
        const result = await send({ action: "note", notes: noteDraft });
        setPayload((current) => current ? { ...current, notes: noteDraft, noteTask: result.noteTask || current.noteTask } : current);
        setNoteSave("saved");
      } catch (saveError) {
        setNoteSave("error");
        setNoteError(saveError instanceof Error ? saveError.message : "Notes could not be saved.");
      }
    }, 700);
    return () => { if (notesTimer.current) clearTimeout(notesTimer.current); };
  }, [noteDraft, payload?.notes, personalListLoading, send]);

  const saveActivity = useCallback(async () => {
    setActivitySave("saving");
    setActivityError("");
    try {
      const result = await send({ action: "activity", categories: activityDraft });
      setPayload((current) => current ? {
        ...current,
        activity: activityDraft,
        dayTask: result.dayTask || current.dayTask,
      } : current);
      setActivitySave("saved");
    } catch (saveError) {
      setActivitySave("error");
      setActivityError(saveError instanceof Error ? saveError.message : "Daily activity could not be saved.");
    }
  }, [activityDraft, send]);

  useEffect(() => {
    if (!activityReady.current || !payload || JSON.stringify(activityDraft) === JSON.stringify(payload.activity || EMPTY_ACTIVITY)) return;
    if (activityTimer.current) clearTimeout(activityTimer.current);
    setActivitySave("pending");
    activityTimer.current = setTimeout(() => { void saveActivity(); }, 850);
    return () => { if (activityTimer.current) clearTimeout(activityTimer.current); };
  }, [activityDraft, payload, saveActivity]);

  const notify = useCallback((title: string, body: string) => {
    if (typeof window === "undefined") return;
    if ("Notification" in window && Notification.permission === "granted") {
      try { new Notification(title, { body, tag: "project-echo-my-day" }); } catch { /* in-app reminder remains available */ }
    }
  }, []);

  const openReminder = useCallback(async () => {
    lastReminderAt.current = Date.now();
    let dueTasks: ReminderTask[] = [];
    if (enableNotebookLists) {
      try {
        const response = await fetch("/api/my-day?reminders=1", { cache: "no-store" });
        if (response.ok) {
          const body = await response.json() as { tasks?: ReminderTask[] };
          if (Array.isArray(body.tasks)) dueTasks = body.tasks;
        }
      } catch { /* Keep the in-memory fallback available. */ }
    }
    if (!dueTasks.length && !enableNotebookLists) {
      const today = todayIso();
      dueTasks = tasks.filter((task) => !task.completed && Boolean(task.dueDate) && task.dueDate <= today).map((task) => ({
        id: task.id, name: task.name, description: task.description, priority: task.priority,
        dueDate: task.dueDate, url: task.url, overdue: task.dueDate < today, notebookDate: date,
      }));
    }
    if (!dueTasks.length) return;
    setReminderTasks(dueTasks);
    setReminderOpen(true);
    lastReminderAt.current = Date.now();
    notify("My Day reminder", dueTasks.slice(0, 5).map((task) => task.name).join(" · "));
  }, [date, enableNotebookLists, notify, tasks]);

  useEffect(() => {
    if (reminderOpen) reminderDialog.current?.querySelector<HTMLElement>("select, button")?.focus();
  }, [reminderOpen]);

  useEffect(() => {
    if (enableNotebookLists || !remindersEnabled || date !== todayIso()) return;
    const timer = setInterval(() => {
      const now = Date.now();
      if (snoozedUntil) {
        if (now >= snoozedUntil) { setSnoozedUntil(0); openReminder(); }
        return;
      }
      const elapsed = now - lastReminderAt.current;
      if (reminderOpen) return;
      if (elapsed >= reminderIntervalSeconds * 1000) openReminder();
    }, 1000);
    return () => clearInterval(timer);
  }, [date, enableNotebookLists, remindersEnabled, reminderIntervalSeconds, reminderOpen, snoozedUntil, openReminder]);

  useEffect(() => {
    if (!settingsReady) return;
    const intervalSeconds = reminderIntervalSeconds;
    localStorage.setItem(REMINDER_KEY, JSON.stringify({ enabled: remindersEnabled, intervalSeconds }));
    const desktop = (window as Window & { mosaicDesktop?: { scheduleReminder: (input: { enabled: boolean; intervalSeconds: number; tasks: ReminderTask[] }) => void } }).mosaicDesktop;
    if (userId) desktop?.scheduleReminder({ enabled: remindersEnabled, intervalSeconds, tasks: [] });
  }, [settingsReady, remindersEnabled, reminderIntervalSeconds, userId]);

  const saveTask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSavingTask(true);
    setError("");
    try {
      const result = await send({ action: "create", name: name.trim(), description, dueDate, priority, dayTaskId: payload?.dayTask?.id, ...(enableNotebookLists ? { listId: selectedNotebookList } : {}) });
      if (result.task && typeof result.task === "object") {
        const createdTask = result.task as DayTask;
        setOptimisticTasks((current) => [createdTask, ...current.filter((task) => task.id !== createdTask.id)]);
        setPayload((current) => current ? {
          ...current,
          dayTask: result.dayTask || current.dayTask,
          tasks: [createdTask, ...current.tasks.filter((task) => task.id !== createdTask.id)],
        } : current);
      }
      setName(""); setDescription(""); setDueDate(date); setPriority("normal");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Task could not be created.");
    } finally { setSavingTask(false); }
  };

  const updateTask = async (taskId: string, changes: Record<string, unknown>, sourceDate = date) => {
    setError("");
    try { await send({ action: "update", taskId, ...changes, ...(enableNotebookLists ? { date: sourceDate } : {}) }); await loadDay(true); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Task could not be updated."); }
  };

  const deleteTask = async (taskId: string, sourceDate = date) => {
    setError("");
    try { await send({ action: "delete", taskId, ...(enableNotebookLists ? { date: sourceDate } : {}) }); await loadDay(true); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Task could not be deleted."); }
  };

  const enableReminders = async () => {
    if (remindersEnabled && "Notification" in window && Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") setNotice("Browser notifications are off. My Day will still show reminders while it is open.");
      return;
    }
    if (!remindersEnabled && "Notification" in window && Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") setNotice("Browser notifications are off. My Day will still show reminders while it is open.");
    }
    setRemindersEnabled(!remindersEnabled);
    lastReminderAt.current = Date.now();
  };

  const overdueReminderTasks = reminderTasks.filter((task) => task.overdue);
  const todayReminderTasks = reminderTasks.filter((task) => !task.overdue);

  const reorderNotebookTasks = async (sourceId: string, targetId: string, list: DayTask[]) => {
    if (!enableNotebookLists || sourceId === targetId) return;
    const source = list.find((task) => task.id === sourceId);
    const target = list.find((task) => task.id === targetId);
    if (!source || !target) return;
    const ordered = [...list];
    const from = ordered.findIndex((task) => task.id === sourceId);
    const targetIndex = ordered.findIndex((task) => task.id === targetId);
    const [moved] = ordered.splice(from, 1);
    ordered.splice(ordered.findIndex((task) => task.id === targetId), 0, moved);
    try {
      await send({ action: "reorder", taskIds: ordered.map((task) => task.id) });
      await loadDay(true);
      const status = document.getElementById("notebook-reorder-status");
      if (status) status.textContent = `Task moved to position ${targetIndex + 1} of ${ordered.length}.`;
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Task order could not be saved."); }
  };

  const canResizeWorkspace = resizableWorkspace && !activityOnly;
  const splitBounds = workspaceWidth === null ? null : getPaneSplitBounds(workspaceWidth);
  const narrowWorkspace = canResizeWorkspace && workspaceWidth !== null && splitBounds === null;
  const paneBounds = splitBounds || { min: 15, max: 85 };
  const visibleTaskPaneRatio = Math.max(paneBounds.min, Math.min(paneBounds.max, taskPaneRatio));

  useEffect(() => {
    if (!canResizeWorkspace) return;
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = Number(window.localStorage.getItem(NOTEBOOK_SPLIT_KEY));
        if (Number.isFinite(stored) && stored >= 15 && stored <= 85) {
          taskPaneRatioRef.current = stored;
          setTaskPaneRatio(stored);
        }
      } catch { /* Use the default split when local storage is unavailable. */ }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [canResizeWorkspace]);

  useEffect(() => {
    const element = workspaceRef.current;
    if (!canResizeWorkspace || !element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWorkspaceWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [canResizeWorkspace]);

  const setPaneRatio = (value: number, persist: boolean) => {
    const next = Math.round(Math.max(paneBounds.min, Math.min(paneBounds.max, value)) * 10) / 10;
    taskPaneRatioRef.current = next;
    setTaskPaneRatio(next);
    if (persist) {
      try { window.localStorage.setItem(NOTEBOOK_SPLIT_KEY, String(next)); }
      catch { /* The split still works for this session. */ }
    }
  };

  const updatePaneRatioFromPointer = (clientX: number) => {
    const bounds = workspaceRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const usableWidth = bounds.width - SPLITTER_WIDTH;
    setPaneRatio(((clientX - bounds.left - SPLITTER_WIDTH / 2) / usableWidth) * 100, false);
  };

  const dateControls = <div className={`flex flex-wrap items-center gap-1 ${enableNotebookLists ? "" : "xl:justify-end"}`}>
    <div className={`flex items-center gap-0.5 ${enableNotebookLists ? "h-8" : "h-9"}`}>
      <button type="button" onClick={() => changeDate(moveDate(date, -1))} aria-label="Previous day" className={`grid place-items-center border border-slate-200 text-slate-600 hover:text-[#003366] ${enableNotebookLists ? "h-8 w-8" : "h-9 w-9"}`}><ChevronLeft size={16} /></button>
      <button type="button" onClick={() => changeDate(todayIso())} className={`border border-slate-200 text-xs font-semibold text-[#003366] hover:border-[#C9A84C] ${enableNotebookLists ? "h-8 px-2" : "h-9 px-3"}`}>Today</button>
      <button type="button" onClick={() => changeDate(moveDate(date, 1))} aria-label="Next day" className={`grid place-items-center border border-slate-200 text-slate-600 hover:text-[#003366] ${enableNotebookLists ? "h-8 w-8" : "h-9 w-9"}`}><ChevronRight size={16} /></button>
    </div>
    <label className={`flex items-center gap-1.5 border border-slate-300 bg-[#FFFCFB] text-sm text-[#003366] ${enableNotebookLists ? "h-8 px-1.5" : "h-9 gap-2 px-2.5"}`}>
      <CalendarDays size={14} /><input type="date" value={date} onChange={(event) => changeDate(event.target.value)} className={`${enableNotebookLists ? "w-[105px]" : "w-[125px]"} bg-transparent text-xs outline-none`} aria-label="Select day" />
    </label>
    <div className={activityOnly ? "hidden" : "relative"}>
      <button type="button" onClick={() => setReminderSettingsOpen((open) => !open)} aria-label="Reminder settings" title="Reminder settings" aria-expanded={reminderSettingsOpen} className={`grid place-items-center border ${enableNotebookLists ? "h-8 w-8" : "h-9 w-9"} ${remindersEnabled ? "border-[#003366] bg-[#003366] text-white" : "border-slate-300 bg-[#FFFCFB] text-[#003366] hover:border-[#C9A84C]"}`}>
        {remindersEnabled ? <Bell size={15} /> : <BellOff size={15} />}
      </button>
      {reminderSettingsOpen && <div className="absolute right-0 top-11 z-30 w-72 border border-slate-200 bg-[#FFFCFB] p-3 shadow-lg">
        <p className="text-xs font-semibold text-[#003366]">Remind every</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {[{ label: "HH", value: reminderHours, set: setReminderHours, max: 99 }, { label: "MM", value: reminderMinutes, set: setReminderMinutes, max: 59 }, { label: "SS", value: reminderSeconds, set: setReminderSeconds, max: 59 }].map(({ label, value, set, max }) => <label key={label} className="text-[10px] font-semibold text-slate-500">{label}<input aria-label={`${label} reminder interval`} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={value} onChange={(event) => set(event.target.value.replace(/\D/g, "").slice(0, 2))} onBlur={(event) => set(String(Math.min(max, Number(event.target.value) || 0)).padStart(2, "0"))} className="mt-1 h-9 w-full border border-slate-300 bg-white px-2 text-sm tabular-nums text-[#003366] outline-none focus:border-[#C9A84C]" /></label>)}
        </div>
        <p className="mt-2 text-[10px] text-slate-500">Choose any interval from one second to 99 hours, 59 minutes, 59 seconds.</p>
        <p className="mt-1 text-[10px] text-slate-500">Desktop reminders appear above other apps while Mosaic runs in the tray.</p>
        <button type="button" onClick={() => void enableReminders()} className="mt-3 w-full border border-slate-200 px-2.5 py-2 text-left text-xs font-semibold text-[#003366] hover:border-[#C9A84C]">{remindersEnabled ? "Turn reminders off" : "Enable reminders"}</button>
      </div>}
    </div>
    {!enableNotebookLists && <button type="button" onClick={() => void requestDayRefresh()} disabled={refreshing} aria-label={activityOnly ? "Refresh daily activity" : "Refresh My Day"} title="Refresh" className="grid h-9 w-9 place-items-center border border-slate-300 bg-[#FFFCFB] text-[#003366] hover:border-[#C9A84C] disabled:opacity-50"><RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /></button>}
  </div>;

  const notebookDateControls = enableNotebookLists && notebookDateControlsTarget ? createPortal(dateControls, notebookDateControlsTarget) : null;

  return (
    <div className={`mx-auto max-w-[1440px] ${enableNotebookLists ? "space-y-2 pb-4" : "space-y-5 pb-8"}`}>
      {notebookDateControls}
      {!enableNotebookLists && <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 xl:flex-row xl:items-center xl:justify-between">
        {!enableNotebookLists && <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Notebook · {activityOnly ? "Activity log" : "Daily workspace"}</p>
          <h1 className="mt-1 font-serif text-3xl italic text-[#003366]">{activityOnly ? "Daily activity" : "My Day"}</h1>
          <p className="mt-1 text-sm text-slate-500">{activityOnly ? "Record and review work completed each day." : "Plan tasks and keep notes together."}</p>
        </div>}
        {dateControls}
      </header>}

      {notice && <div role="status" className="flex items-start justify-between gap-3 border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900"><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss notification note"><X size={14} /></button></div>}
      {error && <div role="alert" className="flex items-start gap-2 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error}</div>}

      <div
        ref={canResizeWorkspace ? workspaceRef : undefined}
        className={canResizeWorkspace ? "grid gap-y-5" : "grid grid-cols-1 gap-5 xl:grid-cols-12"}
        style={canResizeWorkspace ? {
          gridTemplateColumns: narrowWorkspace
            ? "minmax(0, 1fr)"
            : `minmax(0, ${visibleTaskPaneRatio}fr) ${SPLITTER_WIDTH}px minmax(0, ${100 - visibleTaskPaneRatio}fr)`,
        } : undefined}
      >
        {canResizeWorkspace && narrowWorkspace && <div className="col-span-full flex items-center justify-between gap-3">
          <div role="tablist" aria-label="Notebook pane" className="flex border-b border-slate-200">
            <button id="my-day-tasks-tab" type="button" role="tab" aria-selected={narrowPane === "tasks"} onClick={() => setNarrowPane("tasks")} className={`border-b-2 px-3 py-2 text-xs font-semibold ${narrowPane === "tasks" ? "border-[#003366] text-[#003366]" : "border-transparent text-slate-500 hover:text-[#003366]"}`}>Tasks</button>
            <button id="my-day-notes-tab" type="button" role="tab" aria-selected={narrowPane === "notes"} onClick={() => setNarrowPane("notes")} className={`border-b-2 px-3 py-2 text-xs font-semibold ${narrowPane === "notes" ? "border-[#003366] text-[#003366]" : "border-transparent text-slate-500 hover:text-[#003366]"}`}>Notes</button>
          </div>
        </div>}

        <section
          id="my-day-task-pane"
          className={`${enableNotebookLists ? "space-y-2" : "space-y-4"} ${canResizeWorkspace ? "min-w-0" : activityOnly ? "xl:col-span-12" : "xl:col-span-8"}`}
          hidden={narrowWorkspace && narrowPane !== "tasks"}
          role={narrowWorkspace ? "tabpanel" : undefined}
          aria-labelledby={narrowWorkspace ? "my-day-tasks-tab" : undefined}
        >
          {!activityOnly && <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0"><h2 className="font-serif text-xl italic text-[#003366]">{dateLabel(date)}</h2><p className="mt-0.5 text-xs text-slate-500">{currentUserName || "Personal schedule"}</p></div>
            {enableNotebookLists ? <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" onClick={() => { setTaskAiOpen((open) => !open); setTaskAiError(""); }} disabled={isWorking} className="inline-flex h-9 items-center gap-2 border border-[#003366] px-3 text-xs font-semibold text-[#003366] hover:bg-slate-100 disabled:opacity-50"><Sparkles size={14} />Generate with AI</button>
              {onAddTask && <button type="button" onClick={onAddTask} className="inline-flex h-9 items-center gap-2 bg-[#003366] px-3 text-xs font-semibold text-white hover:bg-[#00254a]"><Plus size={14} />Add task</button>}
            </div> : !loading && <span className="border border-slate-200 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{payload?.dayTask ? "Daily log linked" : "Daily log created when you add a task"}</span>}
          </div>

          {enableNotebookLists && taskAiOpen && <section className="space-y-2 border border-slate-300 bg-white p-3" aria-label="Generate tasks with AI">
            <label htmlFor="notebook-task-ai-prompt" className="block text-xs font-semibold text-[#003366]">Describe the tasks to draft</label>
            <textarea id="notebook-task-ai-prompt" value={taskAiPrompt} onChange={(event) => setTaskAiPrompt(event.target.value)} placeholder="Example: Turn today's notes into clear next steps" rows={2} disabled={taskAiState === "loading" || taskAiState === "saving"} className="w-full resize-y border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#003366]" />
            <div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 text-[11px] text-slate-600">Add to<select value={selectedNotebookList} onChange={(event) => setSelectedNotebookList(event.target.value)} className="h-8 border border-slate-300 bg-white px-2 text-xs text-[#003366]" aria-label="AI task destination list">{notebookLists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label><button type="button" onClick={() => void generateTaskDrafts()} disabled={isWorking || taskAiState === "loading" || taskAiState === "saving"} className="inline-flex h-8 items-center gap-1.5 bg-[#003366] px-3 text-xs font-semibold text-white disabled:opacity-50">{taskAiState === "loading" ? <LoaderCircle size={13} className="animate-spin" /> : <Sparkles size={13} />}{taskAiState === "loading" ? "Generating..." : "Generate draft"}</button><button type="button" onClick={() => { setTaskAiOpen(false); setTaskAiState("idle"); setTaskAiDrafts([]); setTaskAiError(""); }} className="h-8 border border-slate-300 px-3 text-xs">Close</button></div>
            {taskAiState === "loading" && <p role="status" className="text-xs text-slate-500">Codex is drafting tasks from this day's notes and task list.</p>}
            {(taskAiError || taskAiState === "error") && <p role="alert" className="text-xs text-red-700">{taskAiError}</p>}
            {taskAiDrafts.length > 0 && <div className="space-y-2 border-t border-slate-200 pt-2"><p className="text-[11px] font-semibold text-slate-600">Review, edit, and select what to add on {dateLabel(date)}.</p>{taskAiDrafts.map((task) => <div key={task.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 border border-slate-200 p-2"><input type="checkbox" checked={task.selected} onChange={(event) => setTaskAiDrafts((current) => current.map((entry) => entry.id === task.id ? { ...entry, selected: event.target.checked } : entry))} aria-label={`Select ${task.name}`} className="mt-2 accent-[#003366]" /><div className="min-w-0 space-y-1.5"><input value={task.name} onChange={(event) => setTaskAiDrafts((current) => current.map((entry) => entry.id === task.id ? { ...entry, name: event.target.value } : entry))} aria-label="Suggested task title" className="h-8 w-full border border-slate-200 px-2 text-xs font-semibold text-[#003366]" /><textarea value={task.description} onChange={(event) => setTaskAiDrafts((current) => current.map((entry) => entry.id === task.id ? { ...entry, description: event.target.value } : entry))} aria-label="Suggested task details" rows={2} className="w-full resize-y border border-slate-200 px-2 py-1 text-xs" /><div className="flex flex-wrap gap-2"><label className="flex items-center gap-1 text-[10px] text-slate-500">Due<input type="date" value={task.dueDate} onChange={(event) => setTaskAiDrafts((current) => current.map((entry) => entry.id === task.id ? { ...entry, dueDate: event.target.value } : entry))} className="h-7 border border-slate-200 px-1 text-xs text-[#003366]" /></label><label className="flex items-center gap-1 text-[10px] text-slate-500">Priority<select value={task.priority} onChange={(event) => setTaskAiDrafts((current) => current.map((entry) => entry.id === task.id ? { ...entry, priority: event.target.value as AiTaskDraft["priority"] } : entry))} className="h-7 border border-slate-200 bg-white px-1 text-xs text-[#003366]"><option value="none">Normal</option><option value="high">High</option></select></label></div></div></div>)}<div className="flex justify-end"><button type="button" onClick={() => void saveSelectedAiTasks()} disabled={taskAiState === "saving" || !taskAiDrafts.some((task) => task.selected && task.name.trim())} className="inline-flex h-8 items-center gap-1.5 bg-[#003366] px-3 text-xs font-semibold text-white disabled:opacity-50">{taskAiState === "saving" ? <LoaderCircle size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}Add selected tasks</button></div></div>}
          </section>}

          {!enableNotebookLists && <form onSubmit={saveTask} className="border border-slate-200 bg-[#FFFCFB] p-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Add a task for this day" aria-label="Task name" className="h-10 min-w-0 flex-1 border border-slate-300 bg-[#FFFCFB] px-3 text-sm outline-none focus:border-[#C9A84C]" />
              <button type="submit" disabled={savingTask || !name.trim()} className="inline-flex h-10 items-center justify-center gap-2 bg-[#003366] px-4 text-xs font-semibold uppercase tracking-wide text-white hover:bg-[#00254a] disabled:opacity-50">
                {savingTask ? <LoaderCircle size={14} className="animate-spin" /> : <Plus size={15} />} Add task
              </button>
            </div>
            <div className={`mt-2 grid grid-cols-1 gap-2 ${enableNotebookLists ? "sm:grid-cols-[minmax(120px,1fr)_150px_140px_150px]" : "sm:grid-cols-[1fr_160px_145px]"}`}>
              <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Details (optional)" aria-label="Task details" className="h-9 border border-slate-200 px-3 text-xs outline-none focus:border-[#C9A84C]" />
              {enableNotebookLists && <select value={selectedNotebookList} onChange={(event) => setSelectedNotebookList(event.target.value)} aria-label="Task list" className="h-9 border border-slate-200 bg-[#FFFCFB] px-2 text-xs text-[#003366] outline-none focus:border-[#C9A84C]">{notebookLists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select>}
              <label className="flex h-9 items-center gap-2 border border-slate-200 px-2 text-[10px] uppercase tracking-wide text-slate-500"><span>Due</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs normal-case tracking-normal text-[#003366] outline-none" /></label>
              <select value={priority} onChange={(event) => setPriority(event.target.value as NonNullable<DayTask["priority"]>)} aria-label="Task priority" className="h-9 border border-slate-200 bg-[#FFFCFB] px-2 text-xs text-[#003366] outline-none focus:border-[#C9A84C]">
                <option value="urgent">Urgent priority</option><option value="high">High priority</option><option value="normal">Normal priority</option><option value="low">Low priority</option>
              </select>
            </div>
          </form>}

          <div className="border border-slate-200 bg-slate-50 p-1">
            {loading && !payload ? <div role="status" aria-live="polite" aria-busy="true" className="space-y-3 p-4">
              <p className="flex items-center gap-2 text-xs text-slate-500"><LoaderCircle size={14} className="animate-spin text-[#003366]" />Loading tasks</p>
              <div aria-hidden="true" className="space-y-2">
                <div className="h-12 motion-safe:animate-pulse border border-slate-100 bg-slate-50" />
                <div className="h-12 motion-safe:animate-pulse border border-slate-100 bg-slate-50" />
                <div className="h-12 motion-safe:animate-pulse border border-slate-100 bg-slate-50" />
              </div>
            </div> :
              tasks.length === 0 ? <div className="p-8 text-center"><CheckCircle2 size={24} className="mx-auto text-[#C9A84C]" /><p className="mt-2 font-serif text-lg italic text-[#003366]">{enableNotebookLists && notebookStatus === "done" ? "No completed tasks" : "A clear day"}</p>{!enableNotebookLists && <p className="mt-1 text-xs text-slate-500">Tasks added here are included in your daily log.</p>}</div> :
                <div className="space-y-1">
                  {enableNotebookLists && <p id="notebook-reorder-status" role="status" className="sr-only" />}
                  {tasks.map((task, index) => <div key={`${task.notebookDate || date}:${task.id}`} onDragOver={(event) => { if (enableNotebookLists) { event.preventDefault(); setDropTargetTaskId(task.id); } }} onDragLeave={() => setDropTargetTaskId("")} onDrop={(event) => {
                    if (!enableNotebookLists) return;
                    event.preventDefault();
                    setDropTargetTaskId("");
                    const sourceId = event.dataTransfer.getData("text/plain");
                    if (sourceId) void reorderNotebookTasks(sourceId, task.id, tasks);
                  }} data-completed={task.completed} data-drop-target={dropTargetTaskId === task.id} className={`mosaic-flat-card group flex gap-2 border p-2 transition-colors ${dropTargetTaskId === task.id ? "border-t-2 border-t-[#007acc]" : "border-slate-200"} ${task.completed ? "bg-slate-50 text-slate-500" : "bg-white text-slate-800 hover:border-[#C9A84C]"}`}>
                    <div className="flex shrink-0 items-start gap-2 pt-0.5">
                      {enableNotebookLists && <button type="button" draggable onDragStart={(event) => { event.dataTransfer.setData("text/plain", task.id); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setDropTargetTaskId("")} onKeyDown={(event) => { if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return; event.preventDefault(); const target = tasks[index + (event.key === "ArrowUp" ? -1 : 1)]; if (target) void reorderNotebookTasks(task.id, target.id, tasks); }} aria-label={`Drag ${task.name} to reorder; use up or down arrow to move`} title="Drag to reorder" className="grid h-5 w-4 place-items-center cursor-grab touch-none text-slate-400 hover:text-[#003366] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#007acc] active:cursor-grabbing"><GripVertical size={15} /></button>}
                      {enableNotebookLists && <button type="button" onClick={() => void updateTask(task.id, { completed: !task.completed, completedDate: task.completed ? null : date, status: task.completed ? payload?.openStatus : payload?.completeStatus }, task.notebookDate || date)} aria-label={task.completed ? `Mark ${task.name} incomplete` : `Complete ${task.name}`} className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center border ${task.completed ? "border-[#003366] bg-[#003366] text-white" : "border-slate-400 hover:border-[#003366]"}`}>{task.completed ? "✓" : ""}</button>}
                      {!enableNotebookLists && <button type="button" onClick={() => void updateTask(task.id, { completed: !task.completed, status: task.completed ? payload?.openStatus : payload?.completeStatus }, task.notebookDate || date)} aria-label={task.completed ? `Mark ${task.name} incomplete` : `Complete ${task.name}`} className="mt-0.5 text-[#003366]">{task.completed ? <CheckCircle2 size={18} className="text-[#C9A84C]" /> : <span className="block h-[18px] w-[18px] border border-slate-400 hover:border-[#003366]" />}</button>}
                    </div>
                    <div className="min-w-0 flex-1">
                      {editingId === task.id ? <div className="space-y-2">
                        <input value={String(editDraft.name || "")} onChange={(event) => setEditDraft((draft) => ({ ...draft, name: event.target.value }))} className="h-9 w-full border border-slate-300 px-2 text-sm outline-none focus:border-[#C9A84C]" aria-label="Edit task name" />
                        <textarea value={String(editDraft.description || "")} onChange={(event) => setEditDraft((draft) => ({ ...draft, description: event.target.value }))} className="min-h-16 w-full resize-y border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-[#C9A84C]" aria-label="Edit task details" />
                        <div className="flex flex-wrap gap-2">
                          <input type="date" value={String(editDraft.dueDate || "")} onChange={(event) => setEditDraft((draft) => ({ ...draft, dueDate: event.target.value }))} className="h-8 border border-slate-200 px-2 text-xs" aria-label="Edit task due date" />
                          <select value={String(editDraft.priority || (enableNotebookLists ? "none" : "normal"))} onChange={(event) => setEditDraft((draft) => ({ ...draft, priority: event.target.value as DayTask["priority"] }))} className="h-8 border border-slate-200 bg-[#FFFCFB] px-2 text-xs" aria-label="Edit task priority">{enableNotebookLists ? <><option value="none">No priority</option><option value="high">High</option></> : <><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></>}</select>
                          {enableNotebookLists && <select value={String(editDraft.listId || "my-tasks")} onChange={(event) => setEditDraft((draft) => ({ ...draft, listId: event.target.value }))} className="h-8 max-w-44 border border-slate-200 bg-[#FFFCFB] px-2 text-xs" aria-label="Edit task list">{notebookLists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select>}
                          <button type="button" onClick={async () => { await updateTask(task.id, editDraft, task.notebookDate || date); setEditingId(""); }} className="inline-flex h-8 items-center gap-1 bg-[#003366] px-3 text-xs font-semibold text-white"><Save size={13} />Save</button>
                          <button type="button" onClick={() => setEditingId("")} className="h-8 border border-slate-200 px-3 text-xs text-slate-600">Cancel</button>
                        </div>
                      </div> : <>
                        <div className={`break-words text-sm font-semibold ${task.completed ? "text-slate-500 line-through" : "text-[#003366]"}`}>{task.name}</div>
                        {task.description && <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-xs leading-snug text-slate-500">{task.description}</p>}
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] uppercase tracking-wide text-slate-500">
                          {enableNotebookLists && <span>{notebookLists.find((list) => list.id === (task.listId || "my-tasks"))?.name || "My Tasks"}</span>}{task.priority === "high" && <span className="notebook-priority-badge border px-1.5 py-0.5 font-semibold">High priority</span>}{task.carriedForward && <span>Since {new Date(`${task.createdDate || task.notebookDate || date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>}{task.dueDate && <span>Due {new Date(`${task.dueDate}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                        </div>
                      </>}
                    </div>
                    <div className="flex shrink-0 items-start gap-1">
                      {editingId !== task.id && <button type="button" onClick={() => { setEditingId(task.id); setEditDraft({ name: task.name, description: task.description, dueDate: task.dueDate, priority: task.priority, listId: task.listId || "my-tasks" }); }} aria-label={`Edit ${task.name}`} title="Edit task" className="grid h-8 w-8 place-items-center border border-slate-200 text-slate-500 hover:border-[#C9A84C] hover:text-[#003366]"><Pencil size={14} /></button>}
                      <button type="button" onClick={() => void deleteTask(task.id, task.notebookDate || date)} aria-label={`Delete ${task.name}`} className="grid h-8 w-8 place-items-center border border-slate-200 text-slate-500 hover:border-red-300 hover:text-red-700"><Trash2 size={14} /></button>
                    </div>
                  </div>)}
                </div>}
          </div>
          </>}
          {showDailyActivity && <section className="border border-slate-200 bg-[#FFFCFB]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="font-serif text-lg italic text-[#003366]">Daily activity</h2>
                <p className="mt-1 text-xs text-slate-500">Saved with this day’s log and shown in Notebook.</p>
              </div>
              <div className="flex items-center gap-3"><span role="status" className="text-[10px] font-semibold text-slate-500">{payload?.date !== date ? "Loading…" : activitySave === "saved" ? "Saved" : activitySave === "saving" ? "Saving…" : activitySave === "pending" ? "Autosave pending" : "Save failed"}</span><button type="button" onClick={() => void generateSummary()} disabled={summaryState === "loading" || tasks.length === 0} title={summaryState === "loading" ? "Generating summary…" : "Generate summary with AI"} aria-label={summaryState === "loading" ? "Generating summary with AI" : "Generate summary with AI"} aria-busy={summaryState === "loading"} className="inline-flex min-h-8 min-w-8 items-center justify-center border border-slate-300 text-[#003366] hover:border-[#003366] disabled:opacity-50"><Sparkles size={14} aria-hidden="true" /></button></div>
            </div>
            {(payload?.date !== date || payload?.isFresh === false) && <p role="status" className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">{enableNotebookLists ? `Loading ${dateLabel(date)} from this device…` : payload?.date === date ? `Refreshing ${dateLabel(date)} from ClickUp…` : `Loading ${dateLabel(date)} from ClickUp…`}</p>}
            {(summaryState === "loading" || summaryError || taskSummary) && <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-2 text-xs text-slate-600" role={summaryError ? "alert" : "status"}>{summaryState === "loading" ? "Preparing a task summary…" : summaryError || (taskSummary ? "A bullet summary of your My Day tasks is included in Ad hoc activity." : "")}</div>}
            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
              {ACTIVITY_FIELDS.map((field) => (
                <label key={field.key} className="block min-w-0">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#003366]">{field.label}</span>
                  <AutoResizeTextarea
                    value={payload?.date === date ? activityDraft[field.key] : ""}
                    onChange={(event) => setActivityDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                    disabled={loading || payload?.date !== date || payload?.isFresh === false}
                    placeholder={"Log " + field.label.toLowerCase() + " work"}
                    rows={3}
                    minHeight={106}
                    className="border border-slate-200 bg-[#FFFCFB] px-3 py-2 text-sm leading-relaxed text-slate-700 outline-none focus:border-[#C9A84C]"
                    aria-label={field.label + " activity"}
                  />
                </label>
              ))}
            </div>
            <div className="flex items-center justify-end border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  if (activityTimer.current) clearTimeout(activityTimer.current);
                  void saveActivity();
                }}
                disabled={activitySave === "saving" || loading || payload?.date !== date || payload?.isFresh === false}
                className="inline-flex min-h-10 items-center gap-2 border border-[#003366] px-3 text-xs font-semibold text-[#003366] hover:bg-[#003366] hover:text-white disabled:opacity-50"
              >
                <Save size={13} />Save now
              </button>
            </div>
            {activityError && <p role="alert" className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">{activityError}</p>}
          </section>}
        </section>

        {canResizeWorkspace && !narrowWorkspace && <div
          role="separator"
          aria-label="Resize task and notes panes"
          aria-orientation="vertical"
          aria-controls="my-day-task-pane my-day-notes-pane"
          aria-valuemin={Math.round(paneBounds.min)}
          aria-valuemax={Math.round(paneBounds.max)}
          aria-valuenow={Math.round(visibleTaskPaneRatio)}
          aria-valuetext={`${Math.round(visibleTaskPaneRatio)}% tasks, ${100 - Math.round(visibleTaskPaneRatio)}% day notes`}
          tabIndex={0}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 5 : 2;
            if (event.key === "ArrowLeft") setPaneRatio(taskPaneRatioRef.current - step, true);
            else if (event.key === "ArrowRight") setPaneRatio(taskPaneRatioRef.current + step, true);
            else if (event.key === "Home") setPaneRatio(paneBounds.min, true);
            else if (event.key === "End") setPaneRatio(paneBounds.max, true);
            else return;
            event.preventDefault();
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            updatePaneRatioFromPointer(event.clientX);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) updatePaneRatioFromPointer(event.clientX);
          }}
          onPointerUp={(event) => {
            updatePaneRatioFromPointer(event.clientX);
            setPaneRatio(taskPaneRatioRef.current, true);
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => setPaneRatio(taskPaneRatioRef.current, true)}
          className="group flex h-full min-h-32 w-6 touch-none cursor-col-resize select-none items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-[#C9A84C]"
        >
          <GripVertical size={17} aria-hidden="true" className="text-slate-400 group-hover:text-[#003366] group-focus-visible:text-[#003366]" />
        </div>}

        {!activityOnly && <aside
          id="my-day-notes-pane"
          className={`space-y-4 ${canResizeWorkspace ? "min-w-0" : "xl:col-span-4"}`}
          hidden={narrowWorkspace && narrowPane !== "notes"}
          role={narrowWorkspace ? "tabpanel" : undefined}
          aria-labelledby={narrowWorkspace ? "my-day-notes-tab" : undefined}
        >
          <section className="border border-slate-200 bg-[#FFFCFB] p-5">
            <div className="flex items-center justify-between gap-2"><h2 className="font-serif text-lg italic text-[#003366]">Notes</h2><div className="flex items-center gap-2">{enableNotebookLists && <button type="button" onClick={() => { setNotesAiOpen((open) => !open); setNotesAiError(""); }} disabled={isWorking} className="inline-flex h-8 items-center gap-1.5 border border-[#003366] px-2.5 text-[11px] font-semibold text-[#003366] hover:bg-slate-100 disabled:opacity-50"><Sparkles size={13} />Generate with AI</button>}<span role="status" className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{enableNotebookLists ? noteSave === "saved" ? "" : noteSave === "saving" ? "Saving..." : noteSave === "pending" ? "Autosave pending" : "Save failed" : noteSave === "saved" ? "Saved to Personal List" : noteSave === "saving" ? "Saving..." : noteSave === "pending" ? "Autosave pending" : "Save failed"}</span></div></div>{enableNotebookLists && notesAiOpen && <section className="mt-3 space-y-2 border border-slate-300 bg-white p-3" aria-label="Generate notes with AI"><label htmlFor="notebook-notes-ai-prompt" className="block text-xs font-semibold text-[#003366]">What should Codex draft?</label><textarea id="notebook-notes-ai-prompt" value={notesAiPrompt} onChange={(event) => setNotesAiPrompt(event.target.value)} placeholder="Example: Organize today's decisions and reminders" rows={2} disabled={notesAiState === "loading"} className="w-full resize-y border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#003366]" /><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void generateNotesDraft()} disabled={isWorking || notesAiState === "loading"} className="inline-flex h-8 items-center gap-1.5 bg-[#003366] px-3 text-xs font-semibold text-white disabled:opacity-50">{notesAiState === "loading" ? <LoaderCircle size={13} className="animate-spin" /> : <Sparkles size={13} />}{notesAiState === "loading" ? "Generating..." : "Generate draft"}</button><button type="button" onClick={() => { setNotesAiOpen(false); setNotesAiState("idle"); setNotesAiError(""); }} className="h-8 border border-slate-300 px-3 text-xs">Close</button></div>{notesAiState === "loading" && <p role="status" className="text-xs text-slate-500">Codex is using this day's notes and tasks as context.</p>}{(notesAiError || notesAiState === "error") && <p role="alert" className="text-xs text-red-700">{notesAiError}</p>}{notesAiState === "preview" && <><label htmlFor="notebook-notes-ai-preview" className="block text-xs font-semibold text-slate-600">Review and edit draft before applying</label><textarea id="notebook-notes-ai-preview" value={notesAiDraft} onChange={(event) => setNotesAiDraft(event.target.value)} rows={8} className="w-full resize-y border border-slate-300 px-3 py-2 text-sm leading-relaxed text-slate-700" /><div className="flex justify-end gap-2"><button type="button" onClick={() => applyNotesDraft("append")} className="h-8 border border-[#003366] px-3 text-xs font-semibold text-[#003366]">Append</button><button type="button" onClick={() => applyNotesDraft("replace")} className="h-8 bg-[#003366] px-3 text-xs font-semibold text-white">Replace notes</button></div></>}</section>}
            {!enableNotebookLists && <p className="mt-2 text-xs leading-relaxed text-slate-500">{personalListLoading ? "Loading your saved Personal List…" : personalList?.id ? `Stored as a dated subtask of Notes in ${personalList.name}.` : "Choose where your private day notes should be saved."}</p>}
            {!enableNotebookLists && !personalListLoading && !personalList?.id && <form onSubmit={configurePersonalList} className="mt-3 border border-slate-200 bg-slate-50 p-3">
              <label htmlFor="my-day-personal-list" className="block text-xs font-semibold text-[#003366]">Personal List</label>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Paste a list URL or ID. We’ll verify access and remember your choice for next time.</p>
              <div className="mt-2 flex gap-2"><input id="my-day-personal-list" value={personalListInput} onChange={(event) => setPersonalListInput(event.target.value)} placeholder="List URL or ID" className="h-9 min-w-0 flex-1 border border-slate-300 bg-white px-2.5 text-xs outline-none focus:border-[#003366]" /><button type="submit" disabled={!personalListInput.trim() || validatingPersonalList} className="h-9 shrink-0 bg-[#003366] px-3 text-xs font-semibold text-white disabled:opacity-50">{validatingPersonalList ? "Checking…" : "Use this list"}</button></div>
              {personalListError && <p role="alert" className="mt-2 text-xs text-red-700">{personalListError}</p>}
            </form>}
            <div className="mt-3 flex flex-wrap items-center gap-1 border border-slate-200 bg-slate-50 px-2 py-1" role="toolbar" aria-label="Notes formatting" data-note-toolbar onKeyDown={(event) => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled)")); const index = controls.indexOf(document.activeElement as HTMLElement); if (index < 0) return; event.preventDefault(); controls[(index + (event.key === "ArrowRight" ? 1 : -1) + controls.length) % controls.length]?.focus(); }}>
              <button type="button" title="Undo" aria-label="Undo" tabIndex={0} onMouseDown={(event) => { rememberNotesSelection(); event.preventDefault(); }} onClick={() => formatNotes("undo")} className="grid h-7 w-7 place-items-center text-[#cccccc] hover:bg-[#3c3c3c] hover:text-white"><Undo2 size={14} /></button>
              <button type="button" title="Redo" aria-label="Redo" tabIndex={-1} onMouseDown={(event) => { rememberNotesSelection(); event.preventDefault(); }} onClick={() => formatNotes("redo")} className="grid h-7 w-7 place-items-center text-[#cccccc] hover:bg-[#3c3c3c] hover:text-white"><Redo2 size={14} /></button>
              <span aria-hidden="true" className="mx-1 h-5 border-l border-slate-200" />
              {[{ label: "Bold", icon: <Bold size={14} />, command: "bold" }, { label: "Italic", icon: <Italic size={14} />, command: "italic" }, { label: "Underline", icon: <Underline size={14} />, command: "underline" }, { label: "Bulleted list", icon: <List size={14} />, command: "insertUnorderedList" }, { label: "Numbered list", icon: <ListOrdered size={14} />, command: "insertOrderedList" }, { label: "Quote", icon: <Quote size={14} />, command: "formatBlock" }, { label: "Highlight", icon: <Highlighter size={14} />, command: "hiliteColor" }].map((item) => <button key={item.label} type="button" tabIndex={-1} title={item.label} aria-label={item.label} onMouseDown={(event) => { rememberNotesSelection(); event.preventDefault(); }} onClick={() => formatNotes(item.command, item.command === "formatBlock" ? "BLOCKQUOTE" : item.command === "hiliteColor" ? "#ffe08a" : undefined)} className={`grid h-7 w-7 place-items-center ${item.command === "hiliteColor" ? "notebook-highlight-button border" : "text-[#cccccc] hover:bg-[#3c3c3c] hover:text-white"}`}>{item.icon}</button>)}
              <span aria-hidden="true" className="mx-1 h-5 border-l border-slate-200" />
              {[{ label: "Align left", icon: <AlignLeft size={14} />, command: "justifyLeft" }, { label: "Align center", icon: <AlignCenter size={14} />, command: "justifyCenter" }, { label: "Align right", icon: <AlignRight size={14} />, command: "justifyRight" }].map((item) => <button key={item.label} type="button" tabIndex={-1} title={item.label} aria-label={item.label} onMouseDown={(event) => { rememberNotesSelection(); event.preventDefault(); }} onClick={() => formatNotes(item.command)} className="grid h-7 w-7 place-items-center text-[#cccccc] hover:bg-[#3c3c3c] hover:text-white">{item.icon}</button>)}
              <label className="ml-1 flex h-7 items-center gap-1 border-l border-slate-200 pl-2 text-[10px] text-slate-500">Size <select aria-label="Notes font size" tabIndex={-1} value={notesSize} onMouseDown={rememberNotesSelection} onChange={(event) => { const size = event.target.value; setNotesSize(size); formatNotes("fontSize", size); }} className="bg-transparent text-xs text-[#003366] outline-none">{[10, 12, 14, 16, 18, 20, 24, 28, 32, 36].map((size) => <option key={size} value={String(size)}>{size}px</option>)}</select></label>
              <button type="button" title="Add link" aria-label="Add link" tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => { const url = window.prompt("Enter the link URL"); if (url) formatNotes("createLink", url.trim()); }} className="grid h-7 w-7 place-items-center text-[#cccccc] hover:bg-[#3c3c3c] hover:text-white"><Link2 size={14} /></button>
            </div>
            <div ref={notesEditor} contentEditable={!personalListLoading && Boolean(personalList?.id)} suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="Notes" aria-disabled={personalListLoading || !personalList?.id} data-placeholder="Capture decisions, reminders, or thoughts for this day…" onInput={handleNotesInput} onMouseUp={rememberNotesSelection} onKeyUp={rememberNotesSelection} onBlur={() => { rememberNotesSelection(); handleNotesInput(); }} onPaste={(event) => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); handleNotesInput(); }} className="mt-0 min-h-[420px] w-full resize-y overflow-y-auto whitespace-pre-wrap break-words border border-slate-200 border-t-0 bg-[#FFFCFB] p-3 text-sm leading-relaxed text-slate-700 outline-none focus:border-[#C9A84C] empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-[#C9A84C] [&_blockquote]:pl-3 [&_a]:text-[#31577D] [&_a]:underline [&_strong]:font-bold [&_em]:italic [&_mark]:bg-amber-100 [&_small]:text-xs" />
            {(noteError || payload?.notesError) && <div role="alert" className="mt-2 flex gap-2 text-xs text-red-700"><AlertCircle size={14} className="shrink-0" />{noteError || payload?.notesError}</div>}
            {payload?.noteTask?.url && <div className="mt-3"><a href={payload.noteTask.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-[#31577D]">Open note task <ExternalLink size={11} /></a></div>}
          </section>
        </aside>}
      </div>

      {reminderOpen && <div className="fixed inset-0 z-[10000] grid place-items-center bg-black/70 p-4" role="presentation">
        <section ref={reminderDialog} role="alertdialog" aria-modal="true" aria-label="Notebook task reminder" onKeyDown={(event) => { if (event.key !== "Tab") return; const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled)")); if (!controls.length) return; const first = controls[0]; const last = controls[controls.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }} className="w-full max-w-2xl overflow-hidden border border-[#454545] bg-[#1e1e1e] text-[#cccccc] shadow-[0_24px_80px_rgba(0,0,0,.65)]">
          <div className="flex min-h-11 items-center justify-between gap-3 border-b border-[#3c3c3c] px-3">
            <time className="text-base font-medium text-[#e7e7e7]">{reminderDateLabel(todayIso())}</time>
            <button type="button" onClick={() => { setReminderOpen(false); changeDate(todayIso()); }} aria-label="Open Notebook for today" title="Open Notebook" className="grid h-8 w-8 place-items-center text-[#bdbdbd] hover:bg-[#2a2d2e] hover:text-white"><BookOpen size={16} /></button>
          </div>
          <div className="max-h-[min(60vh,420px)] space-y-3 overflow-y-auto p-3">
            {overdueReminderTasks.length > 0 && <section aria-label="Overdue tasks"><h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-[#d7ba7d]">Overdue</h2><ul className="space-y-1.5">{overdueReminderTasks.map((task) => <li key={`${task.id}-${task.notebookDate}`} className="border border-[#3c3c3c] bg-[#252526] px-3 py-2"><p className="text-sm font-semibold text-[#e0e0e0]">{task.name}</p>{task.description && <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[#b5b5b5]">{task.description}</p>}<div className="mt-2 flex flex-wrap gap-1.5"><span className="border border-[#806b42] px-1.5 py-0.5 text-[10px] text-[#e2c08d]">{task.priority} priority</span><span className="border border-[#8f4b43] px-1.5 py-0.5 text-[10px] text-[#f48771]">Due {task.dueDate}</span></div></li>)}</ul></section>}
            {todayReminderTasks.length > 0 && <section aria-label="Tasks due today"><h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-[#d7ba7d]">Due today</h2><ul className="space-y-1.5">{todayReminderTasks.map((task) => <li key={`${task.id}-${task.notebookDate}`} className="border border-[#3c3c3c] bg-[#252526] px-3 py-2"><p className="text-sm font-semibold text-[#e0e0e0]">{task.name}</p>{task.description && <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[#b5b5b5]">{task.description}</p>}<div className="mt-2 flex flex-wrap gap-1.5"><span className="border border-[#555] px-1.5 py-0.5 text-[10px] text-[#ccc]">{task.priority} priority</span><span className="border border-[#555] px-1.5 py-0.5 text-[10px] text-[#ccc]">Due today</span></div></li>)}</ul></section>}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-[#3c3c3c] p-3">
            <select aria-label="Snooze reminder duration" defaultValue="" required onChange={(event) => { const hours = Number(event.target.value); if (!hours) return; const seconds = hours * 3600; setSnoozedUntil(Date.now() + seconds * 1000); (window as Window & { mosaicDesktop?: { respondToReminder: (action: "snooze", seconds: number) => void } }).mosaicDesktop?.respondToReminder("snooze", seconds); setReminderOpen(false); }} className="h-8 min-w-36 border border-[#454545] bg-[#2d2d2d] px-2 text-xs text-[#ccc] outline-none focus:border-[#007acc]"><option value="" disabled>Snooze</option>{[1, 2, 3, 4, 5].map((hours) => <option key={hours} value={hours}>Snooze {hours} hour{hours === 1 ? "" : "s"}</option>)}</select>
            <button type="button" onClick={() => { setReminderOpen(false); lastReminderAt.current = Date.now(); (window as Window & { mosaicDesktop?: { respondToReminder: (action: "dismiss") => void } }).mosaicDesktop?.respondToReminder("dismiss"); }} className="h-8 border border-[#007acc] bg-[#0e639c] px-3 text-xs font-semibold text-white hover:bg-[#1177bb]">Dismiss</button>
          </div>
        </section>
      </div>}
    </div>
  );
}
