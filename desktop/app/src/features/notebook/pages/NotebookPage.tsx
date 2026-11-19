"use client";

import { useState } from "react";
import { CalendarDays, Columns3, List } from "lucide-react";
import MyDayView from "@/features/dashboard/components/MyDayView";
import NotebookBoardView from "@/features/notebook/components/NotebookBoardView";

type NotebookViewMode = "daily" | "week" | "lists";
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export function NotebookPage() {
  const [view, setView] = useState<NotebookViewMode>("daily");
  const [selectedDate, setSelectedDate] = useState(today);
  const views: Array<{ id: NotebookViewMode; label: string; Icon: typeof CalendarDays }> = [
    { id: "daily", label: "Daily", Icon: CalendarDays },
    { id: "week", label: "Week board", Icon: Columns3 },
    { id: "lists", label: "Lists", Icon: List },
  ];

  return <div className="min-h-full">
    <nav aria-label="Notebook views" className="mb-4 flex flex-wrap items-center gap-1 border-b border-slate-200 pb-3">
      {views.map(({ id, label, Icon }) => <button key={id} type="button" onClick={() => setView(id)} aria-pressed={view === id} className={`inline-flex h-9 items-center gap-2 border px-3 text-xs font-semibold transition-colors ${view === id ? "border-[#003366] bg-[#003366] text-white" : "border-transparent text-slate-600 hover:border-slate-300 hover:bg-white"}`}><Icon size={14} />{label}</button>)}
      <span className="ml-auto hidden text-[10px] uppercase tracking-wider text-slate-400 sm:inline">Local Notebook</span>
    </nav>
    <div className={view === "daily" ? "" : "hidden"}>
      <MyDayView userId="mosaic-local" currentUserName="Local User" showDailyActivity={false} resizableWorkspace initialDate={selectedDate} onDateChange={setSelectedDate} enableNotebookLists />
    </div>
    {view !== "daily" && <div className="flex min-h-[68vh] flex-col overflow-hidden border border-slate-200 bg-[#FFFCFB]">
      <NotebookBoardView mode={view} selectedDate={selectedDate} onSelectedDateChange={setSelectedDate} />
    </div>}
  </div>;
}
