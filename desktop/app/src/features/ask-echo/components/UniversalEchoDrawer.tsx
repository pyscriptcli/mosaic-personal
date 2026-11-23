"use client";

import { useEffect, useState } from "react";
import type { ArchivedMeeting } from "@/features/meetings/types/meeting";
import { EchoAI } from "@/features/ask-echo/components/EchoAI";

interface UniversalEchoDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  meetings?: ArchivedMeeting[];
  onOpenSource?: (page: string, recordId: string, url?: string) => void;
}

const MIN_PANEL_WIDTH = 360;
const MAX_PANEL_WIDTH = 960;
const PANEL_WIDTH_KEY = "mosaic.ask-echo.panel-width.v1";

/** Ask Echo is a resizable, nonblocking Codex CLI dock. */
export function UniversalEchoDrawer({ isOpen, onClose }: UniversalEchoDrawerProps) {
  const [panelWidth, setPanelWidth] = useState(560);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
        if (Number.isFinite(stored) && stored >= MIN_PANEL_WIDTH && stored <= MAX_PANEL_WIDTH) setPanelWidth(stored);
      } catch { /* Keep the default width. */ }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const resizeTo = (clientX: number) => {
    const width = Math.round(Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, window.innerWidth - clientX)));
    setPanelWidth(width);
    try { window.localStorage.setItem(PANEL_WIDTH_KEY, String(width)); } catch { /* Session resize still works. */ }
  };

  return (
    <div className={`${isOpen ? "fixed" : "hidden"} pointer-events-none inset-0 z-50 flex justify-end overflow-hidden`}>
      <section aria-label="Ask Echo · Codex CLI" aria-hidden={!isOpen} style={{ width: `${panelWidth}px` }} className="echo-chat-panel pointer-events-auto relative flex h-full min-w-0 max-w-[90vw] flex-col border-l border-line bg-surface-canvas text-fg shadow-2xl max-md:max-w-[85vw]">
        <div
          role="separator"
          aria-label="Resize Ask Echo panel"
          aria-orientation="vertical"
          aria-valuemin={MIN_PANEL_WIDTH}
          aria-valuemax={MAX_PANEL_WIDTH}
          aria-valuenow={panelWidth}
          tabIndex={0}
          onKeyDown={(event) => {
            const change = event.shiftKey ? 40 : 16;
            const next = event.key === "ArrowLeft" ? panelWidth + change : event.key === "ArrowRight" ? panelWidth - change : event.key === "Home" ? MAX_PANEL_WIDTH : event.key === "End" ? MIN_PANEL_WIDTH : null;
            if (next === null) return;
            event.preventDefault();
            const width = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, next));
            setPanelWidth(width);
            try { window.localStorage.setItem(PANEL_WIDTH_KEY, String(width)); } catch { /* Keep session resize. */ }
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            resizeTo(event.clientX);
          }}
          onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeTo(event.clientX); }}
          onPointerUp={(event) => {
            resizeTo(event.clientX);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          className="group absolute inset-y-0 left-0 z-20 flex w-1.5 -translate-x-1/2 touch-none cursor-col-resize items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <span className="h-full w-px bg-transparent group-hover:bg-action-hover group-focus-visible:bg-action" />
        </div>
        <EchoAI visible={isOpen} onClose={onClose} />
      </section>
    </div>
  );
}
