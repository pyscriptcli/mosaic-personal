"use client";
import { Activity, CircleHelp, Headphones, Settings2 } from "lucide-react";
import { MockupWorkspace } from "./MockupWorkspace";
import type { MockupAppState } from "../types";

export function LiveStudioMockup({ state }: { state: MockupAppState }) {
 return <div className="flex h-full min-h-[560px] flex-col overflow-hidden border border-[#303a3d] bg-[#171e20] text-[#e1e8e9] shadow-2xl">
   <header className="flex min-h-14 items-center justify-between border-b border-white/10 bg-[#1a2425] px-4"><div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center border border-[#56bd95]/25 bg-[#19342c] text-[#69d1a4]"><Activity size={16}/></span><div><div className="text-xs font-semibold">Mosaic · Live Studio</div><div className="mt-1 text-[9px] text-[#84928e]">LOCAL WORKSPACE · READY WHEN YOU ARE</div></div></div><div className="flex items-center gap-3 text-[#91a09c]"><Headphones size={15}/><button onClick={()=>state.setSettingsOpen(true)} aria-label="Studio settings"><Settings2 size={16}/></button><CircleHelp size={16}/></div></header>
   <div className="flex min-h-0 flex-1"><aside className="hidden w-44 shrink-0 border-r border-white/10 bg-[#192123] p-3 md:block"><div className="mb-2 px-2 text-[9px] uppercase tracking-[.18em] text-[#71817b]">Your workspace</div>{[["Dashboard","⌂"],["IT Projects","◫"],["Meetings","◷"],["Notebook","▤"],["Notetaker","◉"]].map(([label,icon],i)=><button key={label} onClick={()=>state.navigateTo((["dashboard","projects","meetings","notebook","notetaker"] as const)[i])} className={`flex w-full items-center gap-3 px-2 py-2.5 text-left text-[11px] ${state.section===(["dashboard","projects","meetings","notebook","notetaker"] as const)[i]?"bg-[#1c3936] text-[#8fe2bd]":"text-[#9ba6a3] hover:bg-white/[.04]"}`}><span>{icon}</span>{label}</button>)}</aside><div className="min-w-0 flex-1"><MockupWorkspace state={state} variant="studio"/></div></div>
 </div>;
}
