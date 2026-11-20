import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTokenFromRequest, getUserFromRequest } from "@/lib/auth";
import { requireFeature } from "@/lib/access-control-server";
import { isAskEchoEnabled } from "@/lib/admin-config/store";
import { summarizeMyDayTasks } from "@/features/ask-echo/lib/service";
import {
  DAILY_LOG_LIST_ID, createTask, dateFromTask, ensureDailyTask,
  fetchDailyLogParents, fetchDailyLogParentTree, flattenClickUpTaskTree,
  fetchClickUp, formatDailyName, isValidDate, monthFromTaskName, taskOwner,
  categoryPayload, categoriesFromTask, writeCategories, completeDailyTaskOnTimeIfPopulated,
  type RawClickUpTask,
} from "@/features/notebook/lib/notebookClickup";
import { randomUUID } from "node:crypto";
import { scheduleMosaicWriteSync, stageMosaicWrite } from "@/lib/mosaicWriteStore";
import { readStagedMosaicRecords } from "@/lib/mosaicWriteStore";
import { clickUpScope } from "@/lib/clickupReadStore";
import { fetchAllClickUpListTasks } from "@/lib/clickupCalendarApi";
import { getLocalRecord, getLocalSetting, listLocalRecords, removeLocalNotebookCategories, saveLocalRecord, setLocalSetting } from "@/lib/localFirstDatabase";
import { latestNotebookTaskSnapshots, orderNotebookTasks } from "@/features/notebook/lib/notebookTaskOrdering";

export const maxDuration = 60;

type NotebookList = { id: string; name: string };
const DEFAULT_NOTEBOOK_LIST: NotebookList = { id: "my-tasks", name: "My Tasks" };
const TASK_ORDER_SETTING = "notebook.task-order.v1";

function notebookTaskOrder() {
  const value = getLocalSetting<unknown>(TASK_ORDER_SETTING, []);
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

function allLocalNotebookTasks(throughDate?: string) {
  const records = listLocalRecords("my-day");
  const lists = localNotebookLists();
  const createdDateById = new Map<string, string>();
  for (const record of [...records].sort((left, right) => left.id.localeCompare(right.id))) {
    const data = record.data as { tasks?: Record<string, unknown>[] };
    for (const task of Array.isArray(data.tasks) ? data.tasks : []) {
      const id = String(task.id || "");
      if (id && !createdDateById.has(id)) createdDateById.set(id, record.id);
    }
  }
  const tasks: Array<Record<string, unknown> & { id: string; notebookDate: string }> = [];
  for (const record of records) {
    const data = record.data as { tasks?: Record<string, unknown>[] };
    if (!Array.isArray(data.tasks)) continue;
    let changed = false;
    const normalized = data.tasks.map((task) => {
      const priority = task.priority === "high" ? "high" : null;
      if (task.priority !== priority) changed = true;
      const firstSeenDate = createdDateById.get(String(task.id || "")) || record.id;
      return { ...localTask(task, record.id, lists), createdDate: String(task.createdDate || firstSeenDate), scheduledDate: String(task.scheduledDate || firstSeenDate), priority };
    });
    if (changed) saveLocalRecord("my-day", { id: record.id, title: record.title, data: { ...data, tasks: normalized } });
    tasks.push(...normalized.map((task) => ({ ...task, id: String(task.id), notebookDate: record.id })));
  }
  return orderNotebookTasks(latestNotebookTaskSnapshots(tasks, throughDate), notebookTaskOrder());
}

function localNotebookLists() {
  const record = getLocalRecord<{ lists?: NotebookList[] }>("tasks", "notebook-lists");
  const lists = Array.isArray(record?.data.lists)
    ? record.data.lists.filter((item) => item && typeof item.id === "string" && typeof item.name === "string")
    : [];
  return [DEFAULT_NOTEBOOK_LIST, ...lists.filter((item) => item.id !== DEFAULT_NOTEBOOK_LIST.id)];
}

function saveNotebookLists(lists: NotebookList[]) {
  saveLocalRecord("tasks", { id: "notebook-lists", title: "Notebook lists", data: { lists } });
}

function localTask(task: Record<string, unknown>, date: string, lists: NotebookList[]): Record<string, unknown> & { id: string; priority: string | null; completed: boolean; listId: string; notebookDate: string } {
  const requestedListId = typeof task.listId === "string" ? task.listId : DEFAULT_NOTEBOOK_LIST.id;
  const listId = lists.some((list) => list.id === requestedListId) ? requestedListId : DEFAULT_NOTEBOOK_LIST.id;
  const status = String(task.status || "");
  return { ...task, id: String(task.id || ""), priority: task.priority === "high" ? "high" : null, completed: task.completed === true || /^(complete|completed|closed|done)$/i.test(status), listId, notebookDate: date };
}

type ClickUpTask = RawClickUpTask & {
  description?: string; description_text?: string; text_content?: string; markdown_description?: string;
  priority?: { id?: string | number; priority?: string } | null;
  status?: { status?: string; type?: string };
};

function headers(token: string) {
  return { Authorization: token, "Content-Type": "application/json" };
}

async function clickUpJson(token: string, url: string, init?: RequestInit) {
  const requestHeaders = new Headers(headers(token));
  new Headers(init?.headers).forEach((value, key) => requestHeaders.set(key, value));
  const response = await fetchClickUp(url, { ...init, headers: requestHeaders });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.err || body.error || `ClickUp returned ${response.status}.`);
  return body;
}

async function getPersonalList(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("personalListId") || req.headers.get("x-personal-list-id");
  if (id) return { id, name: req.nextUrl.searchParams.get("personalListName") || "Personal List" };
  const email = getUserFromRequest(req)?.email?.toLowerCase().trim();
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || "";
  if (!email || !supabaseUrl || !supabaseKey) return null;
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data } = await supabase.from("echo_user_preferences").select("preferences").eq("email", email).maybeSingle();
    const preferences = data?.preferences;
    if (preferences?.personal_list_id) return { id: String(preferences.personal_list_id), name: String(preferences.personal_list_name || "Personal List") };
  } catch (error) {
    console.warn("My Day personal list preference lookup failed:", error);
  }
  return null;
}

function userMatches(task: RawClickUpTask, byId: Map<string, RawClickUpTask>, user: ReturnType<typeof getUserFromRequest>) {
  if (!user) return false;
  const owner = taskOwner(task, byId);
  return owner.id === String(user.id) || owner.email.toLowerCase() === user.email.toLowerCase() || owner.name.toLowerCase() === user.username.toLowerCase();
}

async function readPersonalNotes(token: string, listId: string, date: string) {
  const tasks = await fetchAllClickUpListTasks<ClickUpTask>(token, listId, { includeMarkdownDescription: true });
  const stagedRows = await readStagedMosaicRecords(clickUpScope(token), "notebook", listId);
  const stagedIds = new Map(stagedRows.map((row) => [String(row.record_id), String(row.clickup_id || row.record_id)]));
  const taskMap = new Map(tasks.map((task) => [String(task.id), task]));
  for (const row of stagedRows) {
    const id = String(row.clickup_id || row.record_id);
    if (row.is_deleted) { taskMap.delete(id); taskMap.delete(String(row.record_id)); continue; }
    const data = row.record_data && typeof row.record_data === "object" ? row.record_data as Record<string, unknown> : {};
    taskMap.set(id, { ...(taskMap.get(id) || {}), ...data, ...(typeof data.parent === "string" && data.parent ? { parent: stagedIds.get(data.parent) || data.parent } : {}), id } as ClickUpTask);
  }
  tasks.splice(0, tasks.length, ...taskMap.values());
  const parent = tasks.find((task) => !task.parent && task.name?.trim().toLowerCase() === "notes");
  if (!parent) return { parent: null, note: null };
  const note = tasks.find((task) => String(task.parent) === String(parent.id) && dateFromTask(task) === date);
  return { parent, note: note ? { id: String(note.id), name: note.name || formatDailyName(date), description: note.markdown_description || note.description_text || note.text_content || note.description || "", url: note.url || "" } : null };
}

function serializeDayTask(task: ClickUpTask) {
  const priority = Number(task.priority?.id || 3);
  return {
    id: String(task.id), name: task.name || "Untitled task",
    description: task.description_text || task.text_content || task.description || "",
    status: task.status?.status || "to do", statusType: task.status?.type || "",
    completed: task.status?.type === "closed" || /^(complete|completed|closed|done)$/i.test(task.status?.status || ""),
    priority: priority === 1 ? "urgent" : priority === 2 ? "high" : priority === 4 ? "low" : "normal",
    dueDate: task.due_date ? new Date(Number(task.due_date)).toISOString().slice(0, 10) : "",
    url: task.url || "",
  };
}

async function getKpiContext(token: string, date: string, req: NextRequest, forceRefresh = false) {
  const user = getUserFromRequest(req);
  const [remoteTasks, stagedRows] = await Promise.all([
    fetchDailyLogParents(token, { assigneeId: user?.id, forceRefresh, requiredMonths: [date.slice(0, 7)] }),
    readStagedMosaicRecords(clickUpScope(token), "notebook", DAILY_LOG_LIST_ID),
  ]);
  const stagedIds = new Map(stagedRows.map((row) => [String(row.record_id), String(row.clickup_id || row.record_id)]));
  const applyStaged = (source: ClickUpTask[]) => {
    const taskMap = new Map(source.map((task) => [String(task.id), task]));
    for (const row of stagedRows) {
      const id = String(row.clickup_id || row.record_id);
      if (row.is_deleted) { taskMap.delete(id); taskMap.delete(String(row.record_id)); continue; }
      const data = row.record_data && typeof row.record_data === "object" ? row.record_data as Record<string, unknown> : {};
      taskMap.set(id, { ...(taskMap.get(id) || {}), ...data, ...(typeof data.parent === "string" && data.parent ? { parent: stagedIds.get(data.parent) || data.parent } : {}), id } as ClickUpTask);
    }
    return [...taskMap.values()];
  };
  const rootTasks = applyStaged(remoteTasks);
  const monthParent = rootTasks.find((task) => !task.parent && monthFromTaskName(task.name) === date.slice(0, 7) && userMatches(task, new Map(rootTasks.map((item) => [String(item.id), item])), user));
  const tasks = monthParent
    ? applyStaged([...rootTasks, ...flattenClickUpTaskTree(await fetchDailyLogParentTree(token, String(monthParent.id), forceRefresh)) as ClickUpTask[]])
    : rootTasks;
  const byId = new Map(tasks.map((task) => [String(task.id), task]));
  const day = tasks.find((task) => {
    const parent = task.parent ? byId.get(String(task.parent)) : undefined;
    return Boolean(parent && monthFromTaskName(parent.name) === date.slice(0, 7) && dateFromTask(task) === date && userMatches(task, byId, user));
  });
  const dailyLogByDate = monthParent ? tasks.flatMap((task) => {
    if (String(task.parent) !== String(monthParent.id) || !userMatches(task, byId, user)) return [];
    const taskDate = dateFromTask(task);
    if (!taskDate) return [];
    return [{ date: taskDate, dayTask: { id: String(task.id), name: task.name || formatDailyName(taskDate), url: task.url || "" }, activity: categoriesFromTask(task) }];
  }) : [];
  return { tasks, day, dailyLogByDate, syncState: "synced", syncedAt: new Date().toISOString(), isFresh: true };
}

async function getDailyTaskById(token: string, id: string, date: string, req: NextRequest) {
  if (!id) return null;
  const stagedRows = await readStagedMosaicRecords(clickUpScope(token), "notebook", DAILY_LOG_LIST_ID);
  const staged = stagedRows.find((row) => String(row.clickup_id || row.record_id) === id || String(row.record_id) === id);
  if (staged?.is_deleted) return null;
  const stagedData = staged?.record_data && typeof staged.record_data === "object"
    ? staged.record_data as Record<string, unknown>
    : null;
  let task: ClickUpTask;
  if (stagedData) {
    task = { ...stagedData, id: String(staged?.clickup_id || staged?.record_id || id) } as ClickUpTask;
  } else {
    task = await clickUpJson(token, `https://api.clickup.com/api/v2/task/${encodeURIComponent(id)}?include_markdown_description=true`) as ClickUpTask;
  }
  if (dateFromTask(task) !== date || String(task.list?.id || staged?.list_id || "") !== DAILY_LOG_LIST_ID || !task.parent) return null;

  const parentId = String(task.parent);
  const stagedParent = stagedRows.find((row) => String(row.clickup_id || row.record_id) === parentId || String(row.record_id) === parentId);
  const parentData = stagedParent?.record_data && typeof stagedParent.record_data === "object"
    ? stagedParent.record_data as Record<string, unknown>
    : null;
  const parent = parentData
    ? { ...parentData, id: String(stagedParent?.clickup_id || stagedParent?.record_id || parentId) } as ClickUpTask
    : await clickUpJson(token, `https://api.clickup.com/api/v2/task/${encodeURIComponent(parentId)}`) as ClickUpTask;
  const byId = new Map<string, RawClickUpTask>([[String(task.id), task], [String(parent.id), parent]]);
  return monthFromTaskName(parent.name) === date.slice(0, 7) && userMatches(task, byId, getUserFromRequest(req)) ? task : null;
}

export async function GET(req: NextRequest) {
  if (process.env.MOSAIC_DESKTOP === "1") {
    if (req.nextUrl.searchParams.get("reminders") === "1") {
      try {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        const allTasks = allLocalNotebookTasks(today);
        const order = notebookTaskOrder();
        const rank = new Map(order.map((id, index) => [id, index]));
        const tasks = allTasks.flatMap((task) => {
            const notebookDate = task.notebookDate;
            const rawDueDate = typeof task.dueDate === "string" && isValidDate(task.dueDate) ? task.dueDate : notebookDate;
            const status = String(task.status || "");
            const completed = task.completed === true || /^(complete|completed|closed|done)$/i.test(status);
            if (completed || !isValidDate(rawDueDate) || rawDueDate > today) return [];
            return [{
              ...task,
              name: String(task.name || "Untitled task"),
              description: String(task.description || ""),
              priority: task.priority === "high" ? "high" : null,
              dueDate: rawDueDate,
              completed,
              overdue: rawDueDate < today,
              url: String(task.url || ""),
            }];
        });
        tasks.sort((left, right) => Number(right.overdue) - Number(left.overdue) || (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER) || (left.priority === "high" ? -1 : 0) - (right.priority === "high" ? -1 : 0));
        return NextResponse.json({ date: today, tasks }, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        console.error("Local reminder tasks could not load:", error);
        return NextResponse.json({ error: "Reminder tasks could not load from this device." }, { status: 500 });
      }
    }
    if (req.nextUrl.searchParams.get("lists") === "1") {
      return NextResponse.json({ lists: localNotebookLists() }, { headers: { "Cache-Control": "no-store" } });
    }
    if (req.nextUrl.searchParams.get("board") === "1") {
      try {
        const lists = localNotebookLists();
        const tasks = allLocalNotebookTasks();
        return NextResponse.json({ lists, tasks, taskOrder: notebookTaskOrder() }, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        console.error("Local Notebook board load failed:", error);
        return NextResponse.json({ error: "Notebook tasks could not be loaded from this device." }, { status: 500 });
      }
    }
    const date = req.nextUrl.searchParams.get("date") || "";
    if (!isValidDate(date)) return NextResponse.json({ error: "A valid day is required." }, { status: 400 });
    try {
      removeLocalNotebookCategories();
      const current = listLocalRecords("my-day").find((record) => record.id === date);
      const data = current?.data as Record<string, unknown> | undefined;
      const allTasks = allLocalNotebookTasks();
      const tasks = orderNotebookTasks(allTasks.flatMap((task) => {
        const isCompleted = task.completed === true || /^(complete|completed|closed|done)$/i.test(String(task.status || ""));
        const completedDate = String(task.completedDate || (isCompleted ? task.notebookDate : ""));
        const scheduledDate = String(task.scheduledDate || task.notebookDate);
        if (isCompleted && completedDate < date) return [];
        if (isCompleted && completedDate === date) return [{ ...task, completed: true, carriedForward: false }];
        if (scheduledDate <= date) return [{ ...task, completed: false, carriedForward: scheduledDate < date }];
        return [];
      }), notebookTaskOrder());
      const notes = String(data?.notes || "");
      const activity = data?.activity && typeof data.activity === "object" ? data.activity : { client: "", admin: "", adhoc: "", meetings: "" };
      const noteTask = notes ? { id: `${date}:notes`, name: "Notes", description: notes, url: "" } : null;
      return NextResponse.json({
        date, dayTask: { id: date, name: formatDailyName(date), url: "" }, syncState: "local", isFresh: true,
        dailyLogByDate: req.nextUrl.searchParams.get("includeNotes") === "0" ? [] : undefined,
        tasks, taskOrder: notebookTaskOrder(), notes, noteTask, activity, completeStatus: "complete", openStatus: "to do",
        personalList: { id: "local", name: "This device" }, notesError: "", source: "local",
      }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("Local My Day load failed:", error);
      return NextResponse.json({ error: "My Day could not load from this device." }, { status: 500 });
    }
  }
  const token = getTokenFromRequest(req);
  const date = req.nextUrl.searchParams.get("date") || "";
  if (!token) return NextResponse.json({ error: "ClickUp authentication required." }, { status: 401 });
  if (!isValidDate(date)) return NextResponse.json({ error: "A valid day is required." }, { status: 400 });
  try {
    const includeNotes = req.nextUrl.searchParams.get("includeNotes") !== "0";
    const forceRefresh = req.nextUrl.searchParams.get("liveRefresh") === "1";
    const [{ tasks, day, dailyLogByDate, syncState, syncedAt, isFresh }, personalList, listInfo] = await Promise.all([
      getKpiContext(token, date, req, forceRefresh),
      includeNotes ? getPersonalList(req) : Promise.resolve(null),
      includeNotes
        ? clickUpJson(token, `https://api.clickup.com/api/v2/list/${DAILY_LOG_LIST_ID}`)
        : Promise.resolve({ statuses: [] as Array<{ status?: string; type?: string }> }),
    ]);
    const statuses = (listInfo.statuses || []) as Array<{ status?: string; type?: string }>;
    const completeStatus = statuses.find((item) => item.type === "closed" || /complete|done|closed/i.test(item.status || ""))?.status || "complete";
    const openStatus = statuses.find((item) => item.type === "open" && /to do|open|not started/i.test(item.status || ""))?.status || statuses.find((item) => item.type === "open")?.status || "to do";
    let note = null;
    let notesError = "";
    if (personalList && includeNotes) {
      try { note = (await readPersonalNotes(token, personalList.id, date)).note; }
      catch (error) { notesError = error instanceof Error ? error.message : "Personal notes could not be loaded."; }
    }
    const children = day ? tasks.filter((task) => String(task.parent) === String(day.id)).map(serializeDayTask) : [];
    return NextResponse.json({
      date, dayTask: day ? { id: String(day.id), name: day.name || formatDailyName(date), url: day.url || "" } : null,
      syncState,
      syncedAt,
      isFresh,
      dailyLogByDate: includeNotes ? undefined : dailyLogByDate,
      tasks: children, notes: note?.description || "", noteTask: note, activity: categoriesFromTask(day),
      completeStatus, openStatus,
      personalList: personalList ? { id: personalList.id, name: personalList.name } : null, notesError,
    });
  } catch (error) {
    console.error("My Day load failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load My Day from ClickUp." }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  if (process.env.MOSAIC_DESKTOP === "1") {
    try {
      const body = await req.json();
      if (body.action === "reorder") {
        if (!Array.isArray(body.taskIds) || body.taskIds.length > 10000 || body.taskIds.some((id: unknown) => typeof id !== "string")) return NextResponse.json({ error: "A valid task order is required." }, { status: 400 });
        const requested = [...new Set(body.taskIds as string[])];
        const allTasks = allLocalNotebookTasks();
        const taskById = new Map(allTasks.map((task) => [task.id, task]));
        const group = requested.map((id) => taskById.get(id));
        if (group.some((task) => !task)) return NextResponse.json({ error: "One or more tasks could not be found." }, { status: 400 });
        const existingOrder = notebookTaskOrder();
        const discovered = allTasks.map((task) => task.id).filter((id) => !existingOrder.includes(id));
        const current = [...existingOrder.filter((id) => taskById.has(id)), ...discovered];
        const requestedSet = new Set(requested);
        let cursor = 0;
        const next = current.map((id) => requestedSet.has(id) ? requested[cursor++] : id);
        if (cursor !== requested.length) next.push(...requested.slice(cursor));
        setLocalSetting(TASK_ORDER_SETTING, next);
        return NextResponse.json({ success: true, taskOrder: next });
      }
      if (typeof body.action === "string" && body.action.endsWith("-list")) {
        const lists = localNotebookLists();
        if (body.action === "create-list") {
          const name = String(body.name || "").trim().slice(0, 60);
          if (!name) return NextResponse.json({ error: "Enter a list name." }, { status: 400 });
          if (lists.some((list) => list.name.toLowerCase() === name.toLowerCase())) return NextResponse.json({ error: "A list with that name already exists." }, { status: 409 });
          const list = { id: randomUUID(), name };
          saveNotebookLists([...lists, list]);
          return NextResponse.json({ lists: [...lists, list], list });
        }
        const listId = String(body.listId || "");
        const target = lists.find((list) => list.id === listId);
        if (!target || (target.id === DEFAULT_NOTEBOOK_LIST.id && body.action !== "reorder-list")) return NextResponse.json({ error: "That Notebook list cannot be changed." }, { status: 404 });
        if (body.action === "rename-list") {
          const name = String(body.name || "").trim().slice(0, 60);
          if (!name) return NextResponse.json({ error: "Enter a list name." }, { status: 400 });
          if (lists.some((list) => list.id !== listId && list.name.toLowerCase() === name.toLowerCase())) return NextResponse.json({ error: "A list with that name already exists." }, { status: 409 });
          const next = lists.map((list) => list.id === listId ? { ...list, name } : list);
          saveNotebookLists(next);
          return NextResponse.json({ lists: next });
        }
        if (body.action === "reorder-list") {
          const index = lists.findIndex((list) => list.id === listId);
          const nextIndex = Math.max(1, Math.min(lists.length - 1, index + (body.direction === "up" ? -1 : 1)));
          const next = [...lists];
          [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
          saveNotebookLists(next);
          return NextResponse.json({ lists: next });
        }
        if (body.action === "delete-list") {
          for (const record of listLocalRecords("my-day")) {
            const data = record.data as Record<string, unknown>;
            if (!Array.isArray(data.tasks) || !(data.tasks as Record<string, unknown>[]).some((task) => task.listId === listId)) continue;
            saveLocalRecord("my-day", { id: record.id, title: record.title, data: { ...data, tasks: (data.tasks as Record<string, unknown>[]).map((task) => task.listId === listId ? { ...task, listId: DEFAULT_NOTEBOOK_LIST.id } : task) } });
          }
          const next = lists.filter((list) => list.id !== listId);
          saveNotebookLists(next);
          return NextResponse.json({ lists: next });
        }
        return NextResponse.json({ error: "Unsupported Notebook list action." }, { status: 400 });
      }
      if (!isValidDate(body.date)) return NextResponse.json({ error: "A valid day is required." }, { status: 400 });
      const date = String(body.date);
      if (body.action === "move") {
        const fromDate = String(body.fromDate || "");
        const listId = String(body.listId || DEFAULT_NOTEBOOK_LIST.id);
        if (!isValidDate(fromDate)) return NextResponse.json({ error: "A valid source day is required." }, { status: 400 });
        if (!localNotebookLists().some((list) => list.id === listId)) return NextResponse.json({ error: "Choose an existing Notebook list." }, { status: 400 });
        const source = listLocalRecords("my-day").find((record) => record.id === fromDate);
        const sourceData = source?.data as Record<string, unknown> | undefined;
        const sourceTasks = Array.isArray(sourceData?.tasks) ? sourceData.tasks as Record<string, unknown>[] : [];
        const task = sourceTasks.find((item) => item.id === body.taskId);
        if (!task || !source) return NextResponse.json({ error: "That task could not be found on its Notebook date." }, { status: 404 });
        if (fromDate === date) {
            saveLocalRecord("my-day", { id: date, title: source.title, data: { ...sourceData, tasks: sourceTasks.map((item) => item.id === body.taskId ? { ...item, listId, scheduledDate: date } : item) } });
        } else {
          const destination = listLocalRecords("my-day").find((record) => record.id === date);
          const destinationData = destination?.data as Record<string, unknown> | undefined;
          saveLocalRecord("my-day", { id: fromDate, title: source.title, data: { ...sourceData, tasks: sourceTasks.filter((item) => item.id !== body.taskId) } });
          saveLocalRecord("my-day", { id: date, title: formatDailyName(date), data: { ...(destinationData || { date }), tasks: [...(Array.isArray(destinationData?.tasks) ? destinationData.tasks as Record<string, unknown>[] : []), { ...task, listId, scheduledDate: date }] } });
        }
        return NextResponse.json({ success: true });
      }
      const current = listLocalRecords("my-day").find((record) => record.id === date);
      const previous = current?.data as Record<string, unknown> | undefined;
      const data: Record<string, unknown> = { ...(previous || {}), date };
      const result: Record<string, unknown> = { success: true, source: "local" };
      if (body.action === "note") {
        const notes = String(body.notes || "");
        data.notes = notes;
        result.noteTask = notes ? { id: `${date}:notes`, name: "Notes", description: notes, url: "" } : null;
      } else if (body.action === "activity") {
        data.activity = categoryPayload(body.categories);
        result.activity = data.activity;
        result.dayTask = { id: date, name: formatDailyName(date), url: "" };
      } else if (body.action === "create") {
        const name = String(body.name || "").trim();
        if (!name) return NextResponse.json({ error: "Enter a task name." }, { status: 400 });
        const listId = String(body.listId || DEFAULT_NOTEBOOK_LIST.id);
        if (!localNotebookLists().some((list) => list.id === listId)) return NextResponse.json({ error: "Choose an existing Notebook list." }, { status: 400 });
        const task = { id: randomUUID(), name, description: String(body.description || ""), status: "to do", priority: body.priority === "high" ? "high" : null, dueDate: body.dueDate || null, listId, createdDate: date, scheduledDate: date, completed: false, url: "" };
        data.tasks = [...(Array.isArray(previous?.tasks) ? previous.tasks : []), task];
        result.task = task;
        result.dayTask = { id: date, name: formatDailyName(date), url: "" };
      } else if (body.action === "update" || body.action === "delete") {
        const tasks = Array.isArray(previous?.tasks) ? previous.tasks as Array<Record<string, unknown>> : [];
        const taskId = String(body.taskId || "");
        const existingTask = tasks.find((task) => task.id === taskId);
        if (!existingTask) return NextResponse.json({ error: "That task is not part of the selected day." }, { status: 404 });
        if (body.action === "delete") {
          data.tasks = tasks.filter((task) => task.id !== taskId);
        } else {
          if (body.listId !== undefined && !localNotebookLists().some((list) => list.id === String(body.listId))) return NextResponse.json({ error: "Choose an existing Notebook list." }, { status: 400 });
          const allowedFields = ["name", "description", "dueDate", "priority", "status", "completed", "completedDate", "listId"];
          const changes = Object.fromEntries(allowedFields.filter((key) => Object.prototype.hasOwnProperty.call(body, key)).map((key) => [key, key === "priority" && body[key] !== "high" ? null : body[key]]));
          data.tasks = tasks.map((task) => task.id === taskId ? {
            ...task, ...changes, id: taskId,
            completed: body.completed === undefined ? /complete|completed|closed|done/i.test(String(body.status ?? task.status ?? "")) : body.completed === true,
            completedDate: body.completed === true ? (typeof body.completedDate === "string" && isValidDate(body.completedDate) ? body.completedDate : date) : body.completed === false ? null : task.completedDate || null,
          } : task);
          result.task = (data.tasks as Array<Record<string, unknown>>).find((task) => task.id === taskId);
        }
        if (body.action === "delete" || body.action === "update") {
          for (const record of listLocalRecords("my-day")) {
            if (record.id === date) continue;
            const recordData = record.data as Record<string, unknown>;
            if (!Array.isArray(recordData.tasks) || !(recordData.tasks as Array<Record<string, unknown>>).some((task) => task.id === taskId)) continue;
            const recordTasks = recordData.tasks as Array<Record<string, unknown>>;
            const duplicateChanges = Object.fromEntries(["name", "description", "dueDate", "priority", "status", "completed", "listId"].filter((key) => Object.prototype.hasOwnProperty.call(body, key)).map((key) => [key, key === "priority" && body[key] !== "high" ? null : body[key]]));
            const nextTasks = body.action === "delete" ? recordTasks.filter((task) => task.id !== taskId) : recordTasks.map((task) => task.id !== taskId ? task : {
              ...task, ...duplicateChanges,
              completed: body.completed === undefined ? /^(complete|completed|closed|done)$/i.test(String(body.status ?? task.status ?? "")) : body.completed === true,
              completedDate: body.completed === true ? (typeof body.completedDate === "string" && isValidDate(body.completedDate) ? body.completedDate : date) : body.completed === false ? null : task.completedDate || null,
            });
            saveLocalRecord("my-day", { id: record.id, title: record.title, data: { ...recordData, tasks: nextTasks } });
          }
        }
      } else if (body.action === "summary") {
        const tasks = Array.isArray(previous?.tasks) ? previous.tasks as Array<Record<string, unknown>> : [];
        const summary = tasks.length ? await summarizeMyDayTasks(tasks.map((task) => ({
          id: String(task.id), name: String(task.name || "Untitled task"), description: String(task.description || ""),
          status: String(task.status || ""), completed: task.completed === true,
        })), { id: "local", name: "Local User", email: "" }) : "";
        return NextResponse.json({ summary, source: "local" });
      } else {
        return NextResponse.json({ error: "Unsupported My Day action." }, { status: 400 });
      }
      saveLocalRecord("my-day", { id: date, title: formatDailyName(date), data });
      return NextResponse.json(result);
    } catch (error) {
      console.error("Local My Day save failed:", error);
      return NextResponse.json({ error: error instanceof Error ? error.message : "My Day change could not be saved." }, { status: 500 });
    }
  }
  const token = getTokenFromRequest(req);
  const user = getUserFromRequest(req);
  if (!token) return NextResponse.json({ error: "ClickUp authentication required." }, { status: 401 });
  if (!user?.id || !user.username) return NextResponse.json({ error: "Your ClickUp profile is required to add a task to the daily log." }, { status: 401 });
  try {
    const body = await req.json();
    if (!isValidDate(body.date)) return NextResponse.json({ error: "A valid day is required." }, { status: 400 });
    const { action } = body;
    const ownerUserId = String(user.id);

    if (action === "note") {
      const personalList = await getPersonalList(req);
      if (!personalList) return NextResponse.json({ error: "Choose a Personal List before saving day notes." }, { status: 400 });
      const notes = await readPersonalNotes(token, personalList.id, body.date);
      let parent = notes.parent;
      if (!parent) {
        parent = await createTask(token, { name: "Notes", description: "Day notes are stored as dated subtasks." }, ownerUserId, personalList.id);
      }
      if (!parent?.id) throw new Error("Could not find or create the Notes parent task in your Personal List.");
      const dateName = formatDailyName(body.date);
      const description = String(body.notes || "");
      if (notes.note) {
        await stageMosaicWrite({ token, ownerUserId, domain: "notebook", recordId: String(notes.note.id), listId: personalList.id, recordData: { ...notes.note, name: dateName, description } as never, operation: "update", method: "PUT", resourcePath: `/task/${notes.note.id}`, requestBody: { name: dateName, markdown_content: description } });
        scheduleMosaicWriteSync();
        return NextResponse.json({ success: true, noteTask: { ...notes.note, name: dateName, description } });
      }
      const localId = randomUUID();
      const requestBody = { name: dateName, parent: parent.id, markdown_content: description, due_date: new Date(`${body.date}T12:00:00`).getTime(), due_date_time: false };
      const record = { id: localId, name: dateName, description, parent: parent.id, url: "" };
      await stageMosaicWrite({ token, ownerUserId, domain: "notebook", recordId: localId, listId: personalList.id, recordData: record as never, operation: "create", method: "POST", resourcePath: `/list/${personalList.id}/task`, requestBody });
      scheduleMosaicWriteSync();
      return NextResponse.json({ success: true, noteTask: { ...record, url: "" }, pendingSync: true }, { status: 202 });
    }

    if (action === "summary") {
      const denied = await requireFeature(req, "ask-echo");
      if (denied) return denied;
      if (!(await isAskEchoEnabled())) return NextResponse.json({ error: "AI summaries are currently unavailable." }, { status: 403 });
    }
    let tasks: ClickUpTask[] = [];
    let day: ClickUpTask | undefined;
    if (action === "create" && typeof body.dayTaskId === "string") {
      try { day = await getDailyTaskById(token, body.dayTaskId, body.date, req) || undefined; }
      catch { /* Fall back to the full context lookup if the supplied day is stale. */ }
    }
    if (!day) {
      const context = await getKpiContext(token, body.date, req);
      tasks = context.tasks;
      day = context.day;
    }
    if (action === "summary") {
      if (!day) return NextResponse.json({ summary: "" });
      const dayTasks = tasks.filter((task) => String(task.parent) === String(day.id)).map((task) => ({
        id: String(task.id), name: String(task.name || "Untitled task"),
        description: String(task.description_text || task.text_content || task.description || ""),
        status: String(task.status?.status || ""),
        completed: task.status?.type === "closed" || /^(complete|completed|closed|done)$/i.test(task.status?.status || ""),
      }));
      if (!dayTasks.length) return NextResponse.json({ summary: "" });
      const summary = await summarizeMyDayTasks(dayTasks, { id: user.id, name: user.username, email: user.email });
      return NextResponse.json({ summary });
    }
    if (action === "activity") {
      const categories = categoryPayload(body.categories);
      const context = day
        ? { daily: day }
        : await ensureDailyTask(token, body.date, { id: String(user.id), name: user.username }, ownerUserId);
      await writeCategories(token, String(context.daily.id), categories, ownerUserId);
      const statusResult = await completeDailyTaskOnTimeIfPopulated(token, String(context.daily.id), context.daily.status?.status || "to do", categories, ownerUserId);
      return NextResponse.json({
        success: true,
        dayTask: { id: String(context.daily.id), name: context.daily.name || formatDailyName(body.date), url: context.daily.url || "" },
        activity: categories,
        ...statusResult,
      });
    }
    if (action === "create") {
      const title = String(body.name || "").trim();
      if (!title) return NextResponse.json({ error: "Enter a task name." }, { status: 400 });
      const context = day ? { daily: day } : await ensureDailyTask(token, body.date, { id: String(user.id), name: user.username }, ownerUserId);
      const payload: Record<string, unknown> = { name: title, parent: context.daily.id, description: String(body.description || "") };
      if (body.dueDate && isValidDate(body.dueDate)) { payload.due_date = new Date(`${body.dueDate}T12:00:00`).getTime(); payload.due_date_time = false; }
      const priority = ({ urgent: 1, high: 2, normal: 3, low: 4 } as Record<string, number>)[body.priority];
      if (priority) payload.priority = priority;
      const created = await createTask(token, payload, ownerUserId, String(context.daily.list?.id || DAILY_LOG_LIST_ID));
      return NextResponse.json({ success: true, task: serializeDayTask(created as ClickUpTask), dayTask: { id: String(context.daily.id), name: context.daily.name, url: context.daily.url }, pendingSync: true }, { status: 202 });
    }

    if (action === "update" || action === "delete") {
      const taskId = String(body.taskId || "");
      const task = tasks.find((item) => String(item.id) === taskId && String(item.parent) === String(day?.id));
      if (!task || !day) return NextResponse.json({ error: "That task is not part of the selected day." }, { status: 404 });
      if (action === "delete") {
        await stageMosaicWrite({ token, ownerUserId, domain: "notebook", recordId: taskId, listId: String(task.list?.id || DAILY_LOG_LIST_ID), recordData: {}, operation: "delete", method: "DELETE", resourcePath: `/task/${taskId}` });
        scheduleMosaicWriteSync();
        return NextResponse.json({ success: true, pendingSync: true }, { status: 202 });
      }
      const payload: Record<string, unknown> = {};
      if (typeof body.name === "string") payload.name = body.name.trim();
      if (typeof body.description === "string") payload.description = body.description;
      if (body.dueDate !== undefined) { payload.due_date = body.dueDate ? new Date(`${body.dueDate}T12:00:00`).getTime() : null; payload.due_date_time = false; }
      if (body.priority) payload.priority = ({ urgent: 1, high: 2, normal: 3, low: 4 } as Record<string, number>)[body.priority] || 3;
      if (body.status) payload.status = String(body.status);
      const projected = { ...task, ...payload, id: taskId };
      await stageMosaicWrite({ token, ownerUserId, domain: "notebook", recordId: taskId, listId: String(task.list?.id || DAILY_LOG_LIST_ID), recordData: projected as never, operation: "update", method: "PUT", resourcePath: `/task/${taskId}`, requestBody: payload as never });
      scheduleMosaicWriteSync();
      return NextResponse.json({ success: true, task: serializeDayTask(projected as ClickUpTask), pendingSync: true }, { status: 202 });
    }
    return NextResponse.json({ error: "Unsupported My Day action." }, { status: 400 });
  } catch (error) {
    console.error("My Day save failed:", error);
    const status = Number((error as { status?: number })?.status || 502);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save this My Day change." }, { status: status >= 500 ? 502 : status });
  }
}
