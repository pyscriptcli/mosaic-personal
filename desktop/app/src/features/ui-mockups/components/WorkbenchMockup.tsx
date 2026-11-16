"use client";
import { MockupWorkspace } from "./MockupWorkspace";
import type { MockupAppState } from "../types";

export function WorkbenchMockup({ state }: { state: MockupAppState }) {
  return <div className="vscode-workbench relative flex h-full min-h-[560px] flex-col overflow-hidden border border-[#3c3c3c] bg-[#1e1e1e] font-[Segoe_UI,system-ui,sans-serif] text-[#cccccc] shadow-[0_14px_60px_rgba(0,0,0,.35)]">
    <div className="flex h-8 items-center justify-between bg-[#3c3c3c] px-3 text-[11px]"><span>Mosaic <span className="text-[#b0b0b0]">—</span> Workbench</span><span className="font-mono text-[9px] text-[#c5c5c5]">LOCAL · OFFLINE READY</span></div>
    <div className="relative min-h-0 flex-1"><MockupWorkspace state={state} variant="workbench"/></div>
  </div>;
}
