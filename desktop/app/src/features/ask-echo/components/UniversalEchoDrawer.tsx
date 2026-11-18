"use client";

import { Sparkles, X } from "lucide-react";
import { EchoAI } from "@/features/ask-echo/components/EchoAI";
import type { ArchivedMeeting } from "@/features/meetings/types/meeting";

interface UniversalEchoDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  meetings?: ArchivedMeeting[];
  onOpenSource?: (page: string, recordId: string, url?: string) => void;
}

/** Ask Echo is the local Codex CLI chat surface in the desktop app. */
export function UniversalEchoDrawer({ isOpen, onClose }: UniversalEchoDrawerProps) {
  return (
    <div className={`${isOpen ? "fixed" : "hidden"} inset-0 z-50 flex justify-end overflow-hidden`}>
      <button aria-label="Close Ask Echo" onClick={onClose} className="fixed inset-0 hidden bg-black/60 max-md:block" />
      <section aria-label="Ask Echo · Codex CLI" className="relative flex h-full w-full flex-col border-l border-[#2b2b2b] bg-[#1f1f1f] text-[#cccccc] shadow-2xl md:w-[min(540px,42vw)]">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#2b2b2b] bg-[#181818] px-4">
          <div className="flex items-center gap-2 text-sm font-medium"><Sparkles size={15} className="text-[#0078d4]" />Ask Echo <span className="text-xs font-normal text-[#9d9d9d]">· Codex CLI</span></div>
          <button type="button" onClick={onClose} aria-label="Close Ask Echo" className="rounded p-1.5 text-[#bdbdbd] hover:bg-[#3c3c3c] hover:text-white"><X size={16} /></button>
        </header>
        <EchoAI visible={isOpen} />
      </section>
    </div>
  );
}
