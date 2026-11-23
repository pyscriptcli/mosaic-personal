"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarDays, Columns3, List, Plus, X } from "lucide-react";
import MyDayView from "@/features/dashboard/components/MyDayView";
import NotebookBoardView from "@/features/notebook/components/NotebookBoardView";
import { currentNotebookDate, isNotebookWeekday } from "@/features/notebook/lib/notebookDates";

type NotebookViewMode = "daily" | "week" | "lists";
type TaskFilter = "todo" | "done";
type NotebookList = { id: string; name: string };
const DEFAULT_LIST_ID = "my-tasks";
export function NotebookPage() {
  const [view, setView] = useState<NotebookViewMode>("daily");
  const [filter, setFilter] = useState<TaskFilter>("todo");
  const [selectedDate, setSelectedDate] = useState(currentNotebookDate);
  const [lists, setLists] = useState<NotebookList[]>([{ id: DEFAULT_LIST_ID, name: "My Tasks" }]);
  const [dialogError, setDialogError] = useState("");
  const [saving, setSaving] = useState(false);
  const [taskDate, setTaskDate] = useState(selectedDate);
  const [dueDate, setDueDate] = useState(selectedDate);
  const [listId, setListId] = useState(DEFAULT_LIST_ID);
  const [priority, setPriority] = useState<"high" | "none">("none");
  const dialog = useRef<HTMLDialogElement>(null);
  const [dateControlsHost, setDateControlsHost] = useState<HTMLDivElement | null>(null);
  const views: Array<{ id: NotebookViewMode; label: string; Icon: typeof CalendarDays }> = [
    { id: "daily", label: "Daily", Icon: CalendarDays },
    { id: "week", label: "Weekly", Icon: Columns3 },
    { id: "lists", label: "Lists", Icon: List },
  ];

  useEffect(() => {
    let cancelled = false;
    const loadLists = async () => {
      try {
        const response = await fetch("/api/my-day?lists=1", { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || cancelled || !Array.isArray(body.lists) || !body.lists.length) return;
        const nextLists = body.lists as NotebookList[];
        setLists(nextLists);
        setListId((current) => nextLists.some((list) => list.id === current) ? current : DEFAULT_LIST_ID);
      } catch { /* Keep the last known list options when local data is unavailable. */ }
    };
    const handleListsChanged = () => { void loadLists(); };
    void loadLists();
    window.addEventListener("mosaic-notebook-lists-changed", handleListsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("mosaic-notebook-lists-changed", handleListsChanged);
    };
  }, []);

  const openAddTask = () => {
    setTaskDate(selectedDate);
    setDueDate(selectedDate);
    setListId(DEFAULT_LIST_ID);
    setPriority("none");
    setDialogError("");
    dialog.current?.showModal();
  };

  const createTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get("name") || "").trim();
    if (!name || !taskDate) return;
    if (!isNotebookWeekday(taskDate)) { setDialogError("Choose a weekday for the Notebook day."); return; }
    if (dueDate && !isNotebookWeekday(dueDate)) { setDialogError("Choose a weekday due date. Weekend due dates aren’t allowed."); return; }
    setSaving(true);
    setDialogError("");
    try {
      const response = await fetch("/api/my-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", date: taskDate, name, description: String(form.get("description") || ""), dueDate: dueDate || null, priority: priority === "high" ? "high" : null, listId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Task could not be added.");
      setSelectedDate(taskDate);
      window.dispatchEvent(new Event("mosaic-notebook-tasks-changed"));
      dialog.current?.close();
      formElement.reset();
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "Task could not be added.");
    } finally { setSaving(false); }
  };

  const heading = view === "daily" ? { eyebrow: "Notebook", title: "My Day", subtitle: "Plan tasks and keep notes together." }
    : view === "week" ? { eyebrow: "NOTEBOOK · WEEKLY WORKSPACE", title: "My Week", subtitle: "Move through the week and see unfinished work carry forward." }
      : { eyebrow: "NOTEBOOK · LIST WORKSPACE", title: "My Lists", subtitle: "Organize tasks into lists." };

  return <div className="mx-auto flex min-h-full max-w-[1440px] flex-col space-y-3 pb-4">
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div className="min-w-0"><h1 className="font-serif text-3xl italic text-fg">{heading.title}</h1><p className="mt-1 text-sm text-fg-muted">{heading.subtitle}</p></div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <nav aria-label="Notebook views" className="flex flex-wrap items-center gap-1">
          {views.map(({ id, label, Icon }) => <button key={id} type="button" onClick={() => setView(id)} aria-pressed={view === id} className={`inline-flex h-9 items-center gap-2 border px-3 text-xs font-semibold transition-colors ${view === id ? "border-link bg-action text-on-action" : "border-line text-fg-secondary hover:border-control-border hover:bg-surface-hover"}`}><Icon size={14} />{label}</button>)}
          {view !== "daily" && <button type="button" onClick={openAddTask} className="inline-flex h-9 items-center gap-2 bg-action px-3 text-xs font-semibold text-on-action hover:bg-action-hover"><Plus size={14} />Add task</button>}
        </nav>
        <div ref={setDateControlsHost} className={view === "daily" ? "flex flex-wrap items-center gap-1" : "hidden"} />
      </div>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div role="tablist" aria-label="Task status" className="flex border-b border-line">
        {(["todo", "done"] as const).map((value) => <button key={value} id={`notebook-${value}-tab`} type="button" role="tab" aria-selected={filter === value} tabIndex={filter === value ? 0 : -1} onClick={() => setFilter(value)} onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault();
          const next = event.key === "Home" || event.key === "ArrowLeft" ? "todo" : "done";
          setFilter(next);
          document.getElementById(`notebook-${next}-tab`)?.focus();
        }} className={`border-b-2 px-3 py-2 text-xs font-semibold uppercase ${filter === value ? "border-link text-fg" : "border-transparent text-fg-muted hover:text-fg"}`}>{value === "todo" ? "To do" : "Completed"}</button>)}
      </div>
    </div>
    <div id="notebook-task-view" role="tabpanel" aria-labelledby={`notebook-${filter}-tab`} className="min-h-0 flex-1">
      <div className={view === "daily" ? "h-full" : "hidden"}>
        <MyDayView userId="mosaic-local" currentUserName="Local User" showDailyActivity={false} resizableWorkspace initialDate={selectedDate} onDateChange={setSelectedDate} enableNotebookLists notebookStatus={filter} onAddTask={openAddTask} notebookDateControlsTarget={dateControlsHost} />
      </div>
      {view !== "daily" && <div className="flex min-h-[68vh] flex-col overflow-hidden border border-line bg-surface-panel">
        <NotebookBoardView mode={view} selectedDate={selectedDate} onSelectedDateChange={setSelectedDate} status={filter} />
      </div>}
    </div>

    <dialog ref={dialog} aria-labelledby="notebook-add-task-title" onClose={() => setDialogError("")} className="fixed left-1/2 top-1/2 m-0 max-h-[min(90dvh,44rem)] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 border border-line bg-surface-panel p-0 text-fg shadow-2xl backdrop:overflow-hidden backdrop:bg-scrim/50 backdrop:overscroll-contain [overscroll-behavior:contain]">
      <form onSubmit={createTask} className="flex max-h-[min(90dvh,44rem)] flex-col">
        <header className="flex items-center justify-between border-b border-line px-5 py-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-muted">Notebook</p><h2 id="notebook-add-task-title" className="mt-1 font-serif text-xl italic text-fg">Add a task</h2></div><button type="button" onClick={() => dialog.current?.close()} aria-label="Close task dialog" className="grid h-8 w-8 place-items-center text-fg-muted hover:bg-surface-hover"><X size={16} /></button></header>
        <div className="grid gap-3 overflow-y-auto p-5">
          <label className="grid gap-1 text-xs font-semibold text-fg">Task title<input name="name" required autoFocus maxLength={300} className="h-10 border border-line bg-surface-panel px-3 text-sm font-normal outline-none focus:border-focus" placeholder="What needs to get done?" /></label>
          <label className="grid gap-1 text-xs font-semibold text-fg">Details<textarea name="description" rows={3} maxLength={10000} className="resize-y border border-line bg-surface-panel px-3 py-2 text-sm font-normal outline-none focus:border-focus" placeholder="Add context or steps (optional)" /></label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-fg">Notebook day<input type="date" required value={taskDate} onChange={(event) => { const value = event.target.value; if (!isNotebookWeekday(value)) { setDialogError("Choose a weekday for the Notebook day."); return; } setTaskDate(value); setDialogError(""); }} className="h-9 border border-line bg-surface-panel px-2 text-sm font-normal outline-none focus:border-focus" /></label>
            <label className="grid gap-1 text-xs font-semibold text-fg"><span className="flex items-center justify-between">Due date<button type="button" onClick={() => { setDueDate(""); setDialogError(""); }} className="text-[11px] font-semibold text-link underline decoration-link underline-offset-2 hover:text-fg">Clear due date</button></span><input type="date" value={dueDate} onChange={(event) => { const value = event.target.value; if (value && !isNotebookWeekday(value)) { setDialogError("Choose a weekday due date. Weekend due dates aren’t allowed."); return; } setDueDate(value); setDialogError(""); }} className="h-9 border border-line bg-surface-panel px-2 text-sm font-normal outline-none focus:border-focus" /></label>
            <label className="grid gap-1 text-xs font-semibold text-fg">List<select value={listId} onChange={(event) => setListId(event.target.value)} className="h-9 border border-line bg-surface-panel px-2 text-sm font-normal outline-none focus:border-focus">{lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>
            <label className="grid gap-1 text-xs font-semibold text-fg">Priority<select value={priority} onChange={(event) => setPriority(event.target.value as "high" | "none")} className="h-9 border border-line bg-surface-panel px-2 text-sm font-normal outline-none focus:border-focus"><option value="none">No priority</option><option value="high">High</option></select></label>
          </div>
          {dialogError && <p role="alert" className="text-xs text-danger-fg">{dialogError}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-line px-5 py-3"><button type="button" onClick={() => dialog.current?.close()} className="h-9 border border-line px-3 text-xs text-fg hover:bg-surface-hover">Cancel</button><button type="submit" disabled={saving} className="h-9 bg-action px-4 text-xs font-semibold text-on-action ">{saving ? "Adding…" : "Add task"}</button></footer>
      </form>
    </dialog>
  </div>;
}
