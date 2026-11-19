"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CalendarDays, ChevronLeft, ChevronRight, ListPlus, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";

type NotebookList = { id: string; name: string };
type NotebookTask = {
  id: string; name: string; description?: string; status?: string; priority?: string;
  dueDate?: string | null; completed: boolean; listId: string; notebookDate: string;
};

const DEFAULT_LIST_ID = "my-tasks";
const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const parseDate = (value: string) => new Date(`${value}T12:00:00`);
const shiftDate = (value: string, amount: number) => { const date = parseDate(value); date.setDate(date.getDate() + amount); return isoDate(date); };
const startOfWeek = (value: string) => { const date = parseDate(value); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return isoDate(date); };
const dayLabel = (value: string) => parseDate(value).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

export default function NotebookBoardView({ mode, selectedDate, onSelectedDateChange }: {
  mode: "week" | "lists"; selectedDate: string; onSelectedDateChange: (date: string) => void;
}) {
  const [lists, setLists] = useState<NotebookList[]>([{ id: DEFAULT_LIST_ID, name: "My Tasks" }]);
  const [tasks, setTasks] = useState<NotebookTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [listName, setListName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [newTaskNames, setNewTaskNames] = useState<Record<string, string>>({});
  const weekDates = useMemo(() => Array.from({ length: 5 }, (_, index) => shiftDate(startOfWeek(selectedDate), index)), [selectedDate]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/my-day?board=1", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Notebook tasks could not be loaded.");
      setLists(Array.isArray(body.lists) && body.lists.length ? body.lists : [{ id: DEFAULT_LIST_ID, name: "My Tasks" }]);
      setTasks(Array.isArray(body.tasks) ? body.tasks : []);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Notebook tasks could not be loaded.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
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

  const createTask = (date: string, listId: string) => {
    const key = `${date}:${listId}`;
    const name = (newTaskNames[key] || "").trim();
    if (!name) return;
    setNewTaskNames((current) => ({ ...current, [key]: "" }));
    void change({ action: "create", date, name, description: "", priority: "normal", listId });
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

  const complete = (task: NotebookTask) => void change({ action: "update", date: task.notebookDate, taskId: task.id, completed: !task.completed, status: task.completed ? "to do" : "complete" });
  const listNameFor = (id: string) => lists.find((list) => list.id === id)?.name || "My Tasks";
  const weekTasks = tasks.filter((task) => weekDates.includes(task.notebookDate));
  const openCount = mode === "week" ? weekTasks.filter((task) => !task.completed).length : tasks.filter((task) => !task.completed).length;

  const renderTask = (task: NotebookTask) => (
    <article key={task.id} draggable onDragStart={(event) => { event.dataTransfer.setData("text/plain", JSON.stringify({ id: task.id, date: task.notebookDate })); event.dataTransfer.effectAllowed = "move"; }} className={`group border p-3 shadow-sm ${task.completed ? "border-slate-200 bg-slate-50 text-slate-500" : "border-slate-200 bg-white text-slate-800 hover:border-[#C9A84C]"}`}>
      <div className="flex items-start gap-2.5">
        <button type="button" onClick={() => complete(task)} aria-label={task.completed ? `Reopen ${task.name}` : `Complete ${task.name}`} className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center border ${task.completed ? "border-[#003366] bg-[#003366] text-white" : "border-slate-400 hover:border-[#003366]"}`}>{task.completed ? "✓" : ""}</button>
        <div className="min-w-0 flex-1">
          <div className={`break-words text-sm font-semibold ${task.completed ? "line-through" : "text-[#003366]"}`}>{task.name}</div>
          {task.description && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-slate-500">{task.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-wide text-slate-500">
            {mode === "week" ? <span>{listNameFor(task.listId)}</span> : <span>{dayLabel(task.notebookDate)}</span>}
            {task.priority && <span>· {task.priority}</span>}
            {task.dueDate && <span>· Due {parseDate(task.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
          </div>
          <label className="mt-2 block">
            <span className="sr-only">{mode === "week" ? `Move ${task.name} to a weekday` : `Move ${task.name} to a list`}</span>
            {mode === "week" ? <select value={task.notebookDate} onChange={(event) => move(task, { date: event.target.value })} className="h-7 max-w-full border border-slate-200 bg-transparent px-1.5 text-[10px] text-slate-600 focus:border-[#003366]">{weekDates.map((date) => <option key={date} value={date}>{dayLabel(date)}</option>)}</select>
              : <select value={task.listId} onChange={(event) => move(task, { listId: event.target.value })} className="h-7 max-w-full border border-slate-200 bg-transparent px-1.5 text-[10px] text-slate-600 focus:border-[#003366]">{lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select>}
          </label>
        </div>
      </div>
    </article>
  );

  const renderColumn = (key: string, title: string, columnTasks: NotebookTask[], date?: string, listId?: string, listControls?: React.ReactNode) => {
    const open = columnTasks.filter((task) => !task.completed);
    const done = columnTasks.filter((task) => task.completed);
    return <section key={key} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
      event.preventDefault();
      try {
        const item = JSON.parse(event.dataTransfer.getData("text/plain")) as { id: string; date: string };
        const task = tasks.find((candidate) => candidate.id === item.id && candidate.notebookDate === item.date);
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
      {(date || listId) && <form onSubmit={(event) => { event.preventDefault(); createTask(date || selectedDate, listId || DEFAULT_LIST_ID); }} className="flex gap-1 border-b border-slate-200 bg-white/70 p-2">
        <input value={newTaskNames[`${date || selectedDate}:${listId || DEFAULT_LIST_ID}`] || ""} onChange={(event) => setNewTaskNames((current) => ({ ...current, [`${date || selectedDate}:${listId || DEFAULT_LIST_ID}`]: event.target.value }))} placeholder="Add a task" aria-label={`Add task to ${title}`} className="h-8 min-w-0 flex-1 bg-transparent px-1 text-xs outline-none placeholder:text-slate-400" />
        <button type="submit" aria-label={`Add task to ${title}`} className="grid h-8 w-8 shrink-0 place-items-center text-[#31577D] hover:bg-slate-100"><Plus size={15} /></button>
      </form>}
      <div className="flex-1 space-y-2 p-2">{open.map(renderTask)}{open.length === 0 && <p className="px-2 py-5 text-center text-xs text-slate-400">No open tasks</p>}</div>
      {done.length > 0 && <details className="border-t border-slate-200">
        <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium text-slate-500 hover:text-[#003366]">Completed ({done.length})</summary>
        <div className="space-y-2 px-2 pb-2">{done.map(renderTask)}</div>
      </details>}
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
      <div><h2 className="font-serif text-lg italic text-[#003366]">{mode === "week" ? "Week board" : "List board"}</h2><p className="mt-0.5 text-xs text-slate-500">{openCount} open tasks · local Notebook</p></div>
      {mode === "week" ? <div className="flex items-center gap-2"><button type="button" onClick={() => onSelectedDateChange(shiftDate(selectedDate, -7))} aria-label="Previous week" className="grid h-8 w-8 place-items-center border border-slate-200 hover:border-[#003366]"><ChevronLeft size={15} /></button><span className="min-w-36 text-center text-xs font-medium text-slate-600">{parseDate(weekDates[0]).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {parseDate(weekDates[4]).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span><button type="button" onClick={() => onSelectedDateChange(shiftDate(selectedDate, 7))} aria-label="Next week" className="grid h-8 w-8 place-items-center border border-slate-200 hover:border-[#003366]"><ChevronRight size={15} /></button></div>
        : <label className="flex items-center gap-2 text-xs text-slate-600">New task date<input type="date" value={selectedDate} onChange={(event) => onSelectedDateChange(event.target.value)} className="h-8 border border-slate-200 bg-white px-2 text-xs text-[#003366]" /></label>}
    </div>
    {mode === "lists" && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5"><p className="text-xs text-slate-500">Drag a task into another list, or use its list selector.</p><form onSubmit={addList} className="flex gap-2"><input value={listName} onChange={(event) => setListName(event.target.value)} placeholder="New list name" aria-label="New list name" className="h-8 w-40 border border-slate-200 px-2 text-xs outline-none focus:border-[#003366]" /><button type="submit" disabled={!listName.trim()} className="inline-flex h-8 items-center gap-1 bg-[#003366] px-2.5 text-xs font-medium text-white disabled:opacity-50"><ListPlus size={14} />Create list</button></form></div>}
    {error && <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">{error}</p>}
    {loading && tasks.length === 0 ? <div role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle size={17} className="animate-spin" />Loading Notebook</div> : <div className="min-h-0 flex-1 overflow-auto p-3"><div className="flex h-full min-h-full items-start gap-3">
      {mode === "week" ? weekDates.map((date) => renderColumn(date, dayLabel(date), weekTasks.filter((task) => task.notebookDate === date), date, DEFAULT_LIST_ID))
        : lists.map((list, index) => renderColumn(list.id, list.name, tasks.filter((task) => task.listId === list.id), undefined, list.id, listControls(list, index)))}
    </div></div>}
  </div>;
}
