"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CalendarDays, ChevronLeft, ChevronRight, GripVertical, ListPlus, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { orderNotebookTasks } from "@/features/notebook/lib/notebookTaskOrdering";

type NotebookList = { id: string; name: string };
type NotebookTask = {
  id: string; name: string; description?: string; status?: string; priority?: string;
  dueDate?: string | null; completed: boolean; listId: string; notebookDate: string; createdDate?: string; scheduledDate?: string; completedDate?: string | null; carriedForward?: boolean; displayDate?: string;
};

const DEFAULT_LIST_ID = "my-tasks";
const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const parseDate = (value: string) => new Date(`${value}T12:00:00`);
const shiftDate = (value: string, amount: number) => { const date = parseDate(value); date.setDate(date.getDate() + amount); return isoDate(date); };
const startOfWeek = (value: string) => { const date = parseDate(value); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return isoDate(date); };
const dayLabel = (value: string) => parseDate(value).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

export default function NotebookBoardView({ mode, selectedDate, onSelectedDateChange, status }: {
  mode: "week" | "lists"; selectedDate: string; onSelectedDateChange: (date: string) => void; status: "todo" | "done";
}) {
  const [lists, setLists] = useState<NotebookList[]>([{ id: DEFAULT_LIST_ID, name: "My Tasks" }]);
  const [tasks, setTasks] = useState<NotebookTask[]>([]);
  const [taskOrder, setTaskOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dropTargetId, setDropTargetId] = useState("");
  const [listName, setListName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const weekDates = useMemo(() => Array.from({ length: 5 }, (_, index) => shiftDate(startOfWeek(selectedDate), index)), [selectedDate]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/my-day?board=1", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Notebook tasks could not be loaded.");
      setLists(Array.isArray(body.lists) && body.lists.length ? body.lists : [{ id: DEFAULT_LIST_ID, name: "My Tasks" }]);
      setTasks(Array.isArray(body.tasks) ? body.tasks : []);
      setTaskOrder(Array.isArray(body.taskOrder) ? body.taskOrder : []);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Notebook tasks could not be loaded.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    const handle = () => { void refresh(); };
    window.addEventListener("mosaic-notebook-tasks-changed", handle);
    return () => window.removeEventListener("mosaic-notebook-tasks-changed", handle);
  }, [refresh]);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch("/api/my-day", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Notebook change could not be saved.");
    if (Array.isArray(result.lists)) {
      setLists(result.lists);
      window.dispatchEvent(new Event("mosaic-notebook-lists-changed"));
    }
    return result;
  }, []);

  const change = async (body: Record<string, unknown>) => {
    setError("");
    try { await post(body); await refresh(); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Notebook change could not be saved."); }
  };

  const move = (task: NotebookTask, destination: { date?: string; listId?: string }) => {
    const date = destination.date || task.notebookDate;
    const listId = destination.listId || task.listId;
    if (date === task.notebookDate && listId === task.listId) return;
    void change({ action: "move", fromDate: task.notebookDate, date, taskId: task.id, listId });
  };

  const addList = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = listName.trim();
    if (!name) return;
    await change({ action: "create-list", name });
    setListName("");
  };

  const saveRename = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!renaming || !renameValue.trim()) return;
    await change({ action: "rename-list", listId: renaming, name: renameValue.trim() });
    setRenaming(null);
  };

  const complete = (task: NotebookTask) => void change({ action: "update", date: task.notebookDate, taskId: task.id, completed: !task.completed, completedDate: task.completed ? null : task.displayDate || selectedDate, status: task.completed ? "to do" : "complete" });
  const listNameFor = (id: string) => lists.find((list) => list.id === id)?.name || "My Tasks";
  const weekTasks = weekDates.flatMap((date) => {
    const daily = tasks.flatMap((task) => {
      const completionDate = task.completedDate || (task.completed ? task.notebookDate : "");
      if (task.completed && completionDate && completionDate < date) return [];
      const scheduledDate = task.scheduledDate || task.notebookDate;
      if (task.completed && completionDate && completionDate > date && scheduledDate <= date) return [{ ...task, completed: false, carriedForward: scheduledDate < date }];
      if (completionDate === date) return [{ ...task, completed: true, carriedForward: false }];
      if (task.completed || scheduledDate > date) return [];
      return [{ ...task, carriedForward: scheduledDate < date }];
    });
    return orderNotebookTasks(daily, taskOrder).map((task) => ({ ...task, displayDate: date }));
  });
  const currentTasks = mode === "week" ? weekTasks : orderNotebookTasks(tasks, taskOrder);
  const visibleTasks = currentTasks.filter((task) => task.completed === (status === "done"));
  const openCount = currentTasks.filter((task) => !task.completed).length;

  const reorder = async (sourceId: string, targetId: string, visible: NotebookTask[]) => {
    const source = visible.find((task) => task.id === sourceId);
    const target = visible.find((task) => task.id === targetId);
    if (!source || !target) return;
    const before = visible.findIndex((task) => task.id === targetId);
    const next = visible.filter((task) => task.id !== sourceId);
    const insertAt = next.findIndex((task) => task.id === targetId);
    next.splice(insertAt, 0, source);
    try {
      const result = await post({ action: "reorder", taskIds: next.map((task) => task.id) });
      setTaskOrder(Array.isArray(result.taskOrder) ? result.taskOrder : taskOrder);
      await refresh();
      const statusNode = document.getElementById("notebook-reorder-status");
      if (statusNode) statusNode.textContent = `Task moved to position ${before + 1} of ${visible.length}.`;
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Task order could not be saved."); }
  };

  const renderTask = (task: NotebookTask, visible: NotebookTask[]) => (
    <article key={`${task.notebookDate}:${task.id}:${"displayDate" in task ? task.displayDate : ""}`} onDragOver={(event) => { event.preventDefault(); setDropTargetId(task.id); }} onDragLeave={() => setDropTargetId("")} onDrop={(event) => { event.preventDefault(); setDropTargetId(""); const id = event.dataTransfer.getData("text/plain"); if (id) void reorder(id, task.id, visible); }} data-completed={task.completed} data-drop-target={dropTargetId === task.id} className={`mosaic-flat-card group border p-2 ${dropTargetId === task.id ? "border-t-2 border-t-[#007acc]" : ""} ${task.completed ? "border-slate-200 bg-slate-50 text-slate-500" : "border-slate-200 bg-white text-slate-800 hover:border-[#C9A84C]"}`}>
      <div className="flex items-start gap-2">
        <div className="flex shrink-0 items-center gap-1"><button type="button" draggable onDragStart={(event) => { event.dataTransfer.setData("text/plain", task.id); event.dataTransfer.effectAllowed = "move"; }} onKeyDown={(event) => { if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return; event.preventDefault(); const index = visible.findIndex((item) => item.id === task.id); const adjacent = visible[index + (event.key === "ArrowUp" ? -1 : 1)]; if (adjacent) void reorder(task.id, adjacent.id, visible); }} aria-label={`Drag ${task.name} to reorder; use up or down arrow to move`} title="Drag to reorder" className="grid h-5 w-4 place-items-center cursor-grab touch-none text-slate-400 hover:text-[#003366] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#007acc] active:cursor-grabbing"><GripVertical size={15} /></button><button type="button" onClick={() => complete(task)} aria-label={task.completed ? `Reopen ${task.name}` : `Complete ${task.name}`} className={`grid h-[18px] w-[18px] shrink-0 place-items-center border ${task.completed ? "border-[#003366] bg-[#003366] text-white" : "border-slate-400 hover:border-[#003366]"}`}>{task.completed ? "✓" : ""}</button></div>
        <div className="min-w-0 flex-1">
          <div className={`break-words text-sm font-semibold ${task.completed ? "line-through" : "text-[#003366]"}`}>{task.name}</div>
          {task.description && <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-xs leading-snug text-slate-500">{task.description}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] uppercase tracking-wide text-slate-500">
            {mode === "week" ? <span>{listNameFor(task.listId)}</span> : <span>{dayLabel(task.notebookDate)}</span>}
            {task.priority === "high" && <span className="notebook-priority-badge border px-1.5 py-0.5 font-semibold">High priority</span>}
            {task.carriedForward && <span>Since {parseDate(task.createdDate || task.notebookDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>}
            {task.dueDate && <span>· Due {parseDate(task.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
          </div>
          <label className="mt-1 block">
            <span className="sr-only">{mode === "week" ? `Move ${task.name} to a weekday` : `Move ${task.name} to a list`}</span>
            {mode === "week" ? <select value={task.notebookDate} onChange={(event) => move(task, { date: event.target.value })} className="h-7 max-w-full border border-slate-200 bg-transparent px-1.5 text-[10px] text-slate-600 focus:border-[#003366]">{weekDates.map((date) => <option key={date} value={date}>{dayLabel(date)}</option>)}</select>
              : <select value={task.listId} onChange={(event) => move(task, { listId: event.target.value })} className="h-7 max-w-full border border-slate-200 bg-transparent px-1.5 text-[10px] text-slate-600 focus:border-[#003366]">{lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select>}
          </label>
        </div>
      </div>
    </article>
  );

  const renderColumn = (key: string, title: string, columnTasks: NotebookTask[], date?: string, listId?: string, listControls?: React.ReactNode) => {
    const visible = columnTasks.filter((task) => task.completed === (status === "done"));
    const open = columnTasks.filter((task) => !task.completed);
    return <section key={key} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
      event.preventDefault();
      try {
        const id = event.dataTransfer.getData("text/plain");
        const task = tasks.find((candidate) => candidate.id === id);
        if (task) move(task, mode === "week" ? { date } : { listId });
      } catch { /* Ignore data dragged from outside Notebook. */ }
    }} className="flex min-h-[420px] w-[272px] shrink-0 flex-col border border-slate-200 bg-[#F7F8FA]">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-[#F7F8FA] px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {renaming === listId ? <form onSubmit={saveRename} className="flex gap-1"><input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} aria-label="Rename list" className="h-7 min-w-0 flex-1 border border-slate-300 bg-white px-2 text-xs" /><button className="h-7 bg-[#003366] px-2 text-[10px] text-white">Save</button></form> : <h3 className="truncate text-sm font-semibold text-[#003366]">{title}</h3>}
            <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">{open.length} open {open.length === 1 ? "task" : "tasks"}</p>
          </div>
          {listControls}
        </div>
        {date && <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-500"><CalendarDays size={12} />{date === isoDate(new Date()) ? "Today" : parseDate(date).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</p>}
      </header>
      <div className="flex-1 space-y-2 p-2">{visible.map((task) => renderTask(task, visible))}{visible.length === 0 && <p className="px-2 py-5 text-center text-xs text-slate-400">{status === "done" ? "No completed tasks" : "No open tasks"}</p>}</div>
    </section>;
  };

  const listControls = (list: NotebookList, index: number) => list.id === DEFAULT_LIST_ID ? null : <div className="flex shrink-0 items-center gap-0.5">
    <button type="button" onClick={() => { setRenaming(list.id); setRenameValue(list.name); }} title={`Rename ${list.name}`} aria-label={`Rename ${list.name}`} className="grid h-7 w-7 place-items-center text-slate-500 hover:bg-slate-200 hover:text-[#003366]"><Pencil size={12} /></button>
    <button type="button" disabled={index === 1} onClick={() => void change({ action: "reorder-list", listId: list.id, direction: "up" })} title="Move list up" aria-label={`Move ${list.name} up`} className="grid h-7 w-7 place-items-center text-slate-500 hover:bg-slate-200 disabled:opacity-30"><ArrowUp size={13} /></button>
    <button type="button" disabled={index === lists.length - 1} onClick={() => void change({ action: "reorder-list", listId: list.id, direction: "down" })} title="Move list down" aria-label={`Move ${list.name} down`} className="grid h-7 w-7 place-items-center text-slate-500 hover:bg-slate-200 disabled:opacity-30"><ArrowDown size={13} /></button>
    <button type="button" onClick={() => { if (window.confirm(`Delete “${list.name}”? Its tasks will move to My Tasks.`)) void change({ action: "delete-list", listId: list.id }); }} title={`Delete ${list.name}`} aria-label={`Delete ${list.name}`} className="grid h-7 w-7 place-items-center text-slate-500 hover:bg-red-50 hover:text-red-700"><Trash2 size={12} /></button>
  </div>;

  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#FFFCFB]">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
      <div><h2 className="font-serif text-lg italic text-[#003366]">{mode === "week" ? "Week board" : "List board"}</h2><p className="mt-0.5 text-xs text-slate-500">{openCount} open tasks</p></div>
      {mode === "week" ? <div className="flex items-center gap-2"><button type="button" onClick={() => onSelectedDateChange(shiftDate(selectedDate, -7))} aria-label="Previous week" className="grid h-8 w-8 place-items-center border border-slate-200 hover:border-[#003366]"><ChevronLeft size={15} /></button><span className="min-w-36 text-center text-xs font-medium text-slate-600">{parseDate(weekDates[0]).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {parseDate(weekDates[4]).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span><button type="button" onClick={() => onSelectedDateChange(shiftDate(selectedDate, 7))} aria-label="Next week" className="grid h-8 w-8 place-items-center border border-slate-200 hover:border-[#003366]"><ChevronRight size={15} /></button></div>
        : <label className="flex items-center gap-2 text-xs text-slate-600">New task date<input type="date" value={selectedDate} onChange={(event) => onSelectedDateChange(event.target.value)} className="h-8 border border-slate-200 bg-white px-2 text-xs text-[#003366]" /></label>}
    </div>
    {mode === "lists" && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5"><p className="text-xs text-slate-500">Drag a task into another list, or use its list selector.</p><form onSubmit={addList} className="flex gap-2"><input value={listName} onChange={(event) => setListName(event.target.value)} placeholder="New list name" aria-label="New list name" className="h-8 w-40 border border-slate-200 px-2 text-xs outline-none focus:border-[#003366]" /><button type="submit" disabled={!listName.trim()} className="inline-flex h-8 items-center gap-1 bg-[#003366] px-2.5 text-xs font-medium text-white disabled:opacity-50"><ListPlus size={14} />Create list</button></form></div>}
    {error && <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">{error}</p>}
    <p id="notebook-reorder-status" role="status" className="sr-only" />
    {loading && tasks.length === 0 ? <div role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle size={17} className="animate-spin" />Loading Notebook</div> : <div className="min-h-0 flex-1 overflow-auto p-3"><div className="flex h-full min-h-full items-start gap-3">
      {mode === "week" ? weekDates.map((date) => { const columnTasks = weekTasks.filter((task) => (task as NotebookTask & { displayDate: string }).displayDate === date); return renderColumn(date, dayLabel(date), columnTasks, date, DEFAULT_LIST_ID); })
        : lists.map((list, index) => renderColumn(list.id, list.name, visibleTasks.filter((task) => task.listId === list.id), undefined, list.id, listControls(list, index)))}
    </div></div>}
  </div>;
}
