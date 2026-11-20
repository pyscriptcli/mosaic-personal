"use client";

import React from "react";
import { Download, Expand, FileCheck2, Lock, Mic2, Upload, Sparkles } from "lucide-react";

export type Stage = "Input" | "Review";

interface StepperProps {
  currentStage: Stage;
  onStageChange: (stage: Stage) => void;
  isReviewAllowed?: boolean;
  onUpload?: () => void;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
  onSaveExport?: () => void;
  canUpload?: boolean;
  onDiscoverTopics?: () => void;
  discoveredTopicsCount?: number;
}

export function Stepper({ 
  currentStage, 
  onStageChange,
  isReviewAllowed = false,
  onUpload,
  onToggleFullscreen,
  isFullscreen = false,
  onSaveExport,
  canUpload = true,
  onDiscoverTopics,
  discoveredTopicsCount,
}: StepperProps) {
  const stages: { name: Stage; label: string; allowed: boolean }[] = [
    { name: "Input", label: "Meeting Workspace", allowed: true },
    { name: "Review", label: "Discussion Review", allowed: isReviewAllowed },
  ];
  
  return (
    <nav className="sticky top-0 z-20 flex w-full min-h-10 flex-wrap items-center justify-between gap-y-1 shrink-0 border-b border-slate-200 bg-white px-2 select-none" aria-label="Notetaker views">
      <div className="flex items-stretch">
      {stages.map((stageItem) => {
        const isActive = currentStage === stageItem.name;
        const isClickable = stageItem.allowed;

        return (
          <button
            key={stageItem.name}
            type="button"
            disabled={!isClickable}
            onClick={() => {
              if (isClickable) {
                onStageChange(stageItem.name);
              }
            }}
            aria-current={isActive ? "page" : undefined}
          className={`group relative flex min-h-10 items-center gap-2 px-3 text-left transition-colors ${isActive ? "bg-[#003366]/[0.04] text-[#003366]" : isClickable ? "text-slate-500 hover:bg-slate-50 hover:text-[#003366]" : "cursor-not-allowed text-slate-300"}`}
          >
            <div className={`flex h-5 w-5 shrink-0 items-center justify-center ${isActive ? "text-[#003366]" : "text-slate-500"}`}>
              {stageItem.name === "Input" ? <Mic2 size={14} /> : <FileCheck2 size={14} />}
            </div>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium">{stageItem.label}{!isClickable && <Lock size={11} />}</span>
            </span>
            {isActive && <span className="absolute inset-x-0 top-0 h-0.5 bg-[#0078D4]" />}
          </button>
        );
      })}
      </div>
      <div className="flex min-w-0 flex-wrap justify-end shrink-0 items-center gap-1 pl-2 py-1">
        {onUpload && canUpload && (
          <button
            type="button"
            onClick={onUpload}
            className="inline-flex h-7 items-center gap-1.5 border border-slate-200 bg-white px-2 text-xs font-medium text-[#003366] hover:border-[#0078D4] transition-colors"
            title="Upload recording or transcript"
          >
            <Upload size={13} />
            <span className="hidden sm:inline">Upload</span>
          </button>
        )}
        {onDiscoverTopics && (
          <button
            type="button"
            onClick={onDiscoverTopics}
            className="inline-flex h-7 items-center gap-1.5 border border-slate-200 bg-white px-2 text-xs font-medium text-[#003366] hover:border-[#0078D4] transition-colors"
            title="Discover and search topics in transcript"
          >
            <Sparkles size={13} className="text-[#0078D4]" />
            <span className="hidden sm:inline">Discover Topics</span>
            {discoveredTopicsCount !== undefined && discoveredTopicsCount > 0 && (
              <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[9px] font-medium bg-[#0078D4]/20 text-[#0078D4] border border-[#0078D4]/40">
                {discoveredTopicsCount}
              </span>
            )}
          </button>
        )}
        {onToggleFullscreen && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="inline-flex h-7 w-7 items-center justify-center border border-slate-200 bg-white text-[#003366] hover:border-[#0078D4] transition-colors"
            title={isFullscreen ? "Exit fullscreen" : "Focus workspace"}
            aria-label={isFullscreen ? "Exit fullscreen" : "Focus workspace"}
          >
            <Expand size={14} />
          </button>
        )}
        {onSaveExport && (
          <button
            type="button"
            disabled={!isReviewAllowed}
            onClick={onSaveExport}
            className={`inline-flex h-7 items-center gap-1.5 px-3 text-xs font-medium border transition-colors disabled:cursor-not-allowed ${isReviewAllowed ? "bg-[#003366] text-white hover:bg-[#002244] border-[#003366]" : "bg-slate-100 text-slate-400 border-slate-200"}`}
            title={isReviewAllowed ? "Save to ClickUp or Export Word/PDF" : "Complete recording or synthesize minutes first"}
          >
            <Download size={13} />
            <span>Save & Export</span>
          </button>
        )}
      </div>
    </nav>
  );
}
