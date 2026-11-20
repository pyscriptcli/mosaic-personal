"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarDays, Columns3, List, Plus, X } from "lucide-react";
import MyDayView from "@/features/dashboard/components/MyDayView";
import NotebookBoardView from "@/features/notebook/components/NotebookBoardView";

type NotebookViewMode = "daily" | "week" | "lists";
type TaskFilter = "todo" | "done";
type NotebookList = { id: string; name: string };
const DEFAULT_LIST_ID = "my-tasks";
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export function NotebookPage() {
  const [view, setView] = useState<NotebookViewMode>("daily");
  const [filter, setFilter] = useState<TaskFilter>("todo");
  const [selectedDate, setSelectedDate] = useState(today);
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
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-3">
      <div className="min-w-0"><h1 className="font-serif text-3xl italic text-[#003366]">{heading.title}</h1><p className="mt-1 text-sm text-slate-500">{heading.subtitle}</p></div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <nav aria-label="Notebook views" className="flex flex-wrap items-center gap-1">
          {views.map(({ id, label, Icon }) => <button key={id} type="button" onClick={() => setView(id)} aria-pressed={view === id} className={`inline-flex h-9 items-center gap-2 border px-3 text-xs font-semibold transition-colors ${view === id ? "border-[#003366] bg-[#003366] text-white" : "border-slate-200 text-slate-600 hover:border-slate-400 hover:bg-white"}`}><Icon size={14} />{label}</button>)}
          {view !== "daily" && <button type="button" onClick={openAddTask} className="inline-flex h-9 items-center gap-2 bg-[#003366] px-3 text-xs font-semibold text-white hover:bg-[#00254a]"><Plus size={14} />Add task</button>}
        </nav>
        <div ref={setDateControlsHost} className={view === "daily" ? "flex flex-wrap items-center gap-1" : "hidden"} />
      </div>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div role="tablist" aria-label="Task status" className="flex border-b border-slate-200">
        {(["todo", "done"] as const).map((value) => <button key={value} id={`notebook-${value}-tab`} type="button" role="tab" aria-selected={filter === value} tabIndex={filter === value ? 0 : -1} onClick={() => setFilter(value)} onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault();
          const next = event.key === "Home" || event.key === "ArrowLeft" ? "todo" : "done";
          setFilter(next);
          document.getElementById(`notebook-${next}-tab`)?.focus();
        }} className={`border-b-2 px-3 py-2 text-xs font-semibold uppercase ${filter === value ? "border-[#003366] text-[#003366]" : "border-transparent text-slate-500 hover:text-[#003366]"}`}>{value === "todo" ? "To do" : "Completed"}</button>)}
      </div>
    </div>
    <div id="notebook-task-view" role="tabpanel" aria-labelledby={`notebook-${filter}-tab`} className="min-h-0 flex-1">
      <div className={view === "daily" ? "h-full" : "hidden"}>
        <MyDayView userId="mosaic-local" currentUserName="Local User" showDailyActivity={false} resizableWorkspace initialDate={selectedDate} onDateChange={setSelectedDate} enableNotebookLists notebookStatus={filter} onAddTask={openAddTask} notebookDateControlsTarget={dateControlsHost} />
      </div>
      {view !== "daily" && <div className="flex min-h-[68vh] flex-col overflow-hidden border border-slate-200 bg-[#FFFCFB]">
        <NotebookBoardView mode={view} selectedDate={selectedDate} onSelectedDateChange={setSelectedDate} status={filter} />
      </div>}
    </div>

    <dialog ref={dialog} aria-labelledby="notebook-add-task-title" onClose={() => setDialogError("")} className="fixed left-1/2 top-1/2 m-0 max-h-[min(90dvh,44rem)] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 border border-slate-300 bg-[#FFFCFB] p-0 text-[#1f2937] shadow-2xl backdrop:overflow-hidden backdrop:bg-black/50 backdrop:overscroll-contain [overscroll-behavior:contain]">
      <form onSubmit={createTask} className="flex max-h-[min(90dvh,44rem)] flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Notebook</p><h2 id="notebook-add-task-title" className="mt-1 font-serif text-xl italic text-[#003366]">Add a task</h2></div><button type="button" onClick={() => dialog.current?.close()} aria-label="Close task dialog" className="grid h-8 w-8 place-items-center text-slate-500 hover:bg-slate-100"><X size={16} /></button></header>
        <div className="grid gap-3 overflow-y-auto p-5">
          <label className="grid gap-1 text-xs font-semibold text-slate-700">Task title<input name="name" required autoFocus maxLength={300} className="h-10 border border-slate-300 bg-white px-3 text-sm font-normal outline-none focus:border-[#003366]" placeholder="What needs to get done?" /></label>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">Details<textarea name="description" rows={3} maxLength={10000} className="resize-y border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[#003366]" placeholder="Add context or steps (optional)" /></label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">Notebook day<input type="date" required value={taskDate} onChange={(event) => setTaskDate(event.target.value)} className="h-9 border border-slate-300 bg-white px-2 text-sm font-normal outline-none focus:border-[#003366]" /></label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700"><span className="flex items-center justify-between">Due date<button type="button" onClick={() => setDueDate("")} className="text-[11px] font-semibold text-[#4fc1ff] underline decoration-[#4fc1ff] underline-offset-2 hover:text-white">Clear due date</button></span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="h-9 border border-slate-300 bg-white px-2 text-sm font-normal outline-none focus:border-[#003366]" /></label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">List<select value={listId} onChange={(event) => setListId(event.target.value)} className="h-9 border border-slate-300 bg-white px-2 text-sm font-normal outline-none focus:border-[#003366]">{lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">Priority<select value={priority} onChange={(event) => setPriority(event.target.value as "high" | "none")} className="h-9 border border-slate-300 bg-white px-2 text-sm font-normal outline-none focus:border-[#003366]"><option value="none">No priority</option><option value="high">High</option></select></label>
          </div>
          {dialogError && <p role="alert" className="text-xs text-red-700">{dialogError}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3"><button type="button" onClick={() => dialog.current?.close()} className="h-9 border border-slate-300 px-3 text-xs text-slate-700 hover:bg-slate-100">Cancel</button><button type="submit" disabled={saving} className="h-9 bg-[#003366] px-4 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Adding…" : "Add task"}</button></footer>
      </form>
    </dialog>
  </div>;
}
