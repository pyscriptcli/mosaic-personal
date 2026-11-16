"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Command, FlaskConical, Sparkles } from "lucide-react";
import { FieldMockup } from "@/features/ui-mockups/components/FieldMockup";
import { LiveStudioMockup } from "@/features/ui-mockups/components/LiveStudioMockup";
import { WorkbenchMockup } from "@/features/ui-mockups/components/WorkbenchMockup";
import type { MockupAppState, MockupSection, MockupTask } from "@/features/ui-mockups/types";

const variants = [
  { id: "workbench", name: "Workbench", story: "Your work, arranged like a familiar editor." },
  { id: "studio", name: "Live Studio", story: "The recording is the center of the meeting." },
  { id: "field", name: "Signal Garden", story: "Ideas connect into a living map." },
] as const;

type VariantId = (typeof variants)[number]["id"];

function isVariant(value: string | null): value is VariantId {
  return variants.some((variant) => variant.id === value);
}

export default function MockupGalleryPage() {
  const [variant, setVariant] = useState<VariantId>("workbench");
  const [section, setSection] = useState<MockupSection>("dashboard");
  const [dateRange, setDateRange] = useState<"Today" | "Week" | "Month">("Week");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMeetingId, setSelectedMeetingId] = useState("Product strategy sync");
  const [projectFilter, setProjectFilter] = useState<"Active" | "All">("Active");
  const [selectedProjectId, setSelectedProjectId] = useState("Product Launch");
  const [tasks, setTasks] = useState<MockupTask[]>([
    { id: 1, title: "Draft customer setup guide", due: "Priya · Tuesday", done: false },
    { id: 2, title: "Confirm pilot invite list", due: "Morgan · Wednesday", done: false },
    { id: 3, title: "Review onboarding feedback", due: "Today", done: true },
  ]);
  const [dayNote, setDayNote] = useState("");
  const [captureStatus, setCaptureStatus] = useState<"ready" | "recording" | "paused" | "complete">("ready");
  const [captureSource, setCaptureSource] = useState<"Screen 1" | "Mosaic window">("Screen 1");
  const [meetingTab, setMeetingTab] = useState<"notes" | "transcript" | "actions">("notes");
  const [echoOpen, setEchoOpen] = useState(false);
  const [echoQuery, setEchoQuery] = useState("");
  const [echoAnswer, setEchoAnswer] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [compactMode, setCompactMode] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  const navigateTo = useCallback((next: MockupSection) => {
    setSection(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
  }, []);

  const appState: MockupAppState = {
    section, navigateTo, dateRange, setDateRange, searchQuery, setSearchQuery,
    selectedMeetingId, setSelectedMeetingId, projectFilter, setProjectFilter,
    selectedProjectId, setSelectedProjectId, tasks,
    addTask: (title) => { if (title.trim()) setTasks((old) => [...old, { id: Date.now(), title: title.trim(), due: "Added just now", done: false }]); },
    toggleTask: (id) => setTasks((old) => old.map((task) => task.id === id ? { ...task, done: !task.done } : task)),
    dayNote, setDayNote, captureStatus, setCaptureStatus, captureSource, setCaptureSource,
    meetingTab, setMeetingTab, echoOpen, setEchoOpen, echoQuery, setEchoQuery,
    echoAnswer, setEchoAnswer, settingsOpen, setSettingsOpen, compactMode, setCompactMode,
    notificationsEnabled, setNotificationsEnabled,
  };

  useEffect(() => {
    const syncFromUrl = () => {
      const requested = new URLSearchParams(window.location.search).get("variant");
      if (isVariant(requested)) setVariant(requested);
      const requestedView = new URLSearchParams(window.location.search).get("view");
      if (["dashboard", "projects", "meetings", "notebook", "notetaker"].includes(requestedView ?? "")) setSection(requestedView as MockupSection);
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  const selectVariant = useCallback((nextVariant: VariantId) => {
    setVariant(nextVariant);
    const url = new URL(window.location.href);
    url.searchParams.set("variant", nextVariant);
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
  }, []);

  useEffect(() => {
    const handleKeys = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const currentIndex = variants.findIndex((item) => item.id === variant);
      const direction = event.key === "ArrowRight" ? 1 : -1;
      selectVariant(variants[(currentIndex + direction + variants.length) % variants.length].id);
    };
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, [selectVariant, variant]);

  const currentIndex = variants.findIndex((item) => item.id === variant);
  const current = variants[currentIndex];

  return (
    <main className="fixed inset-0 z-[120] flex min-h-0 flex-col overflow-hidden bg-[#17191d] font-[Segoe_UI,system-ui,sans-serif] text-[#d4d4d4]">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-[#34373d] bg-[#202226] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-6 w-6 shrink-0 grid-cols-2 gap-0.5 p-0.5" aria-hidden="true">
            <span className="bg-[#007acc]" /><span className="bg-[#65b8ef]" /><span className="bg-[#65b8ef]" /><span className="bg-[#007acc]" />
          </div>
          <span className="truncate text-xs font-medium text-[#e3e3e3]">Mosaic · UI concept lab</span>
          <span className="hidden border border-[#494c52] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-[#9da1a8] sm:inline-flex">Preview only</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[#858a93]">
          <FlaskConical size={13} className="text-[#4fc1ff]" />
          <span className="hidden sm:inline">No data or actions are connected</span>
          <span className="sm:hidden">Mockup</span>
        </div>
      </header>

      <section className="min-h-0 flex-1 p-2 pb-[78px] sm:p-3 sm:pb-[82px]" aria-label={`${current.name} mockup`}>
        {variant === "workbench" && <WorkbenchMockup state={appState} />}
        {variant === "studio" && <LiveStudioMockup state={appState} />}
        {variant === "field" && <FieldMockup state={appState} />}
      </section>

      {process.env.NODE_ENV !== "production" && (
        <nav aria-label="Mockup selector" className="fixed bottom-3 left-1/2 z-[130] flex w-[min(94vw,780px)] -translate-x-1/2 items-center gap-1 border border-[#44474e] bg-[#25272b]/95 p-1.5 shadow-[0_14px_50px_rgba(0,0,0,0.5)] backdrop-blur">
          <button type="button" onClick={() => selectVariant(variants[(currentIndex + variants.length - 1) % variants.length].id)} className="grid h-9 w-9 shrink-0 place-items-center text-[#b5bac2] hover:bg-[#373a40] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4fc1ff]" aria-label="Previous mockup" title="Previous mockup (←)">
            <ChevronLeft size={17} />
          </button>
          <div className="hidden min-w-0 flex-1 items-center gap-2 px-2 md:flex">
            <Command size={14} className="shrink-0 text-[#4fc1ff]" />
            <span className="truncate text-xs font-semibold text-[#e4e6e9]">{current.name}</span>
            <span className="truncate text-[11px] text-[#898f98]">{current.story}</span>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-center gap-1 sm:gap-2" role="group" aria-label="Choose a mockup">
            {variants.map((item, index) => (
              <button key={item.id} type="button" onClick={() => selectVariant(item.id)} aria-pressed={variant === item.id} className={`flex min-w-0 items-center gap-2 px-2.5 py-2 text-[10px] font-semibold transition-colors sm:px-3 ${variant === item.id ? "bg-[#094771] text-white" : "text-[#a5a9b1] hover:bg-[#373a40] hover:text-white"}`}>
                <span className={`font-mono text-[9px] ${variant === item.id ? "text-[#8ed4ff]" : "text-[#777d87]"}`}>0{index + 1}</span>
                <span className="truncate">{item.name}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => selectVariant(variants[(currentIndex + 1) % variants.length].id)} className="grid h-9 w-9 shrink-0 place-items-center text-[#b5bac2] hover:bg-[#373a40] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4fc1ff]" aria-label="Next mockup" title="Next mockup (→)">
            <ChevronRight size={17} />
          </button>
        </nav>
      )}
      <div className="pointer-events-none fixed bottom-[60px] left-1/2 z-[125] hidden -translate-x-1/2 items-center gap-1.5 text-[9px] uppercase tracking-[0.14em] text-[#777d87] md:flex" aria-hidden="true">
        <Sparkles size={11} /> Three directions · one meeting
      </div>
    </main>
  );
}
