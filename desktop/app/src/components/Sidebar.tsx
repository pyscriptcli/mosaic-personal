"use client";

import React from "react";
import { createPortal } from "react-dom";
import { AudioLines, BriefcaseBusiness, CalendarDays, ChevronDown, ChevronRight, LayoutGrid, LogOut, NotebookTabs, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";

export type NavView = "dashboard" | "notebook" | "meetings" | "minutes" | "business-analysis" | "settings";

interface SidebarProps {
  currentView: NavView;
  onSelectView: (view: NavView) => void;
  onPreloadView?: (view: NavView) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  user?: {
    id?: number | string;
    username?: string;
    email?: string;
    color?: string;
    profilePicture?: string | null;
    initials?: string;
    workspaceName?: string;
  } | null;
  onSignOut?: () => void;
  allowedPages?: NavView[];
  sidebarOrder?: NavView[];
}

const allNavItems = [
  { id: "dashboard" as NavView, label: "Dashboard", icon: LayoutGrid },
  { id: "business-analysis" as NavView, label: "IT Projects", icon: BriefcaseBusiness },
  { id: "meetings" as NavView, label: "Meetings", icon: CalendarDays },
  { id: "notebook" as NavView, label: "Notebook", icon: NotebookTabs },
  { id: "minutes" as NavView, label: "Notetaker", icon: AudioLines },
  { id: "settings" as NavView, label: "Settings", icon: Settings },
];

export function Sidebar({
  currentView,
  onSelectView,
  onPreloadView,
  isCollapsed: externalCollapsed,
  onToggleCollapse,
  user,
  onSignOut,
  allowedPages,
  sidebarOrder,
}: SidebarProps) {
  const [isProfileMenuOpen, setIsProfileMenuOpen] = React.useState(false);
  const [expandedWidth, setExpandedWidth] = React.useState(228);
  const [isResizing, setIsResizing] = React.useState(false);
  const [isHoverExpanded, setIsHoverExpanded] = React.useState(false);
  const profileButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const profileMenuRef = React.useRef<HTMLDivElement | null>(null);
  const sidebarRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = Number(window.localStorage.getItem("mosaic.sidebar.width.v1"));
        if (Number.isFinite(stored) && stored >= 180 && stored <= 420) setExpandedWidth(stored);
      } catch { /* Keep the 228 px default. */ }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  React.useEffect(() => {
    if (!isProfileMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!profileMenuRef.current?.contains(target) && !profileButtonRef.current?.contains(target)) setIsProfileMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsProfileMenuOpen(false);
        profileButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isProfileMenuOpen]);

  const effectiveCollapsed = externalCollapsed && !isHoverExpanded;
  const hoverOverlay = externalCollapsed && isHoverExpanded;
  const resizeTo = (clientX: number) => {
    const bounds = sidebarRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const width = Math.round(Math.max(180, Math.min(420, clientX - bounds.left)));
    setExpandedWidth(width);
    try { window.localStorage.setItem("mosaic.sidebar.width.v1", String(width)); } catch { /* Session resize still works. */ }
  };
  const orderIndex = new Map((sidebarOrder || []).map((id, index) => [id, index]));
  const navItems = allNavItems.slice().sort((a, b) => (orderIndex.get(a.id) ?? allNavItems.length) - (orderIndex.get(b.id) ?? allNavItems.length)).filter((item) => Boolean(
    allowedPages?.includes(item.id),
  ));

  const chooseView = (view: NavView) => {
    onSelectView(view);
  };

  return (
    <>
      <aside ref={sidebarRef} onPointerEnter={() => { if (externalCollapsed) setIsHoverExpanded(true); }} onPointerLeave={() => setIsHoverExpanded(false)} style={{ width: externalCollapsed ? 48 : `min(${expandedWidth}px, 38vw)` }} className={`relative z-40 flex h-full shrink-0 flex-col overflow-visible border-r border-vscode-border bg-vscode-sidebar text-vscode-text ${isResizing ? "select-none" : ""}`}>
          <section aria-label="Explorer" style={{ width: externalCollapsed && isHoverExpanded ? `min(${expandedWidth}px, 38vw)` : externalCollapsed ? 48 : `min(${expandedWidth}px, 38vw)` }} className={`flex min-w-0 flex-1 flex-col bg-vscode-sidebar transition-[width,box-shadow] duration-300 ease-out motion-reduce:transition-none ${hoverOverlay ? "absolute inset-y-0 left-0 z-50 shadow-2xl" : "relative"}`}>
            <header className={`flex h-9 shrink-0 items-center ${effectiveCollapsed ? "justify-center px-1" : "justify-between px-3"} text-[11px] font-semibold tracking-[0.08em] text-vscode-text`}>
              <span aria-hidden={effectiveCollapsed} className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity] delay-75 duration-150 motion-reduce:transition-none ${effectiveCollapsed ? "max-w-0 opacity-0" : "max-w-24 opacity-100"}`}>EXPLORER</span>
              <button type="button" onClick={onToggleCollapse} aria-label={effectiveCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={effectiveCollapsed ? "Expand sidebar" : "Collapse sidebar"} className="grid h-7 w-7 place-items-center text-vscode-icon hover:bg-vscode-hover hover:text-vscode-text">{effectiveCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}</button>
            </header>
            <div aria-hidden={effectiveCollapsed} className={`flex shrink-0 items-center gap-1.5 overflow-hidden px-3 text-[12px] font-semibold text-vscode-text transition-[height,opacity] delay-75 duration-150 motion-reduce:transition-none ${effectiveCollapsed ? "h-0 opacity-0" : "h-8 opacity-100"}`}>
              <ChevronDown size={14} className="text-vscode-muted" />
              <span className="truncate">{user?.workspaceName || "Mosaic Personal"}</span>
            </div>
            <nav aria-label="Primary navigation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
              <div className={`flex flex-col py-0.5 ${effectiveCollapsed ? "items-center" : ""}`}>{navItems.map((item) => {
                const Icon = item.icon;
                const isActive = currentView === item.id;
                return <button key={item.id} type="button" onClick={() => chooseView(item.id)} onPointerEnter={() => onPreloadView?.(item.id)} onFocus={() => onPreloadView?.(item.id)} aria-current={isActive ? "page" : undefined} aria-label={effectiveCollapsed ? item.label : undefined} title={effectiveCollapsed ? item.label : undefined} className={`flex min-h-9 items-center ${effectiveCollapsed ? "w-10 justify-center border-l-2 px-1" : "w-full gap-2 border-l-2 px-3 text-left"} text-[13px] transition-colors ${isActive ? "border-vscode-accent bg-vscode-selection text-vscode-text" : "border-transparent text-vscode-text hover:bg-vscode-hover"}`}>{!effectiveCollapsed && <ChevronRight size={13} className="shrink-0 text-vscode-muted" />}<Icon size={15} className={`shrink-0 ${isActive ? "text-vscode-accent" : "text-vscode-icon"}`} /><span aria-hidden={effectiveCollapsed} className={`overflow-hidden truncate transition-[max-width,opacity] delay-75 duration-150 motion-reduce:transition-none ${effectiveCollapsed ? "max-w-0 opacity-0" : "max-w-40 opacity-100"}`}>{item.label}</span></button>;
              })}</div>
            </nav>
          </section>
          <div className={`flex items-center ${effectiveCollapsed ? "justify-center px-1" : "justify-between px-3"} border-t border-vscode-border py-2`}>
            <span aria-hidden={effectiveCollapsed} className={`truncate text-[11px] text-vscode-muted transition-[max-width,opacity] delay-75 duration-150 motion-reduce:transition-none ${effectiveCollapsed ? "max-w-0 opacity-0" : "max-w-40 opacity-100"}`}>{user?.username || "Local profile"}</span>
            <div className="flex items-center gap-2">
              {onSignOut && !effectiveCollapsed && <button type="button" onClick={onSignOut} aria-label="Sign out" title="Sign out" className="text-vscode-icon hover:text-vscode-text"><LogOut size={14} /></button>}
              <button ref={profileButtonRef} type="button" aria-label="Open profile menu" aria-expanded={isProfileMenuOpen} aria-controls="profile-menu" title={user?.username || "Local profile"} onClick={() => setIsProfileMenuOpen((open) => !open)} className="grid h-6 w-6 place-items-center rounded-full border border-vscode-border bg-vscode-raised text-[9px] font-semibold text-vscode-text hover:border-vscode-icon">{user?.profilePicture ? <img src={user.profilePicture} alt="" className="h-full w-full rounded-full object-cover" /> : user?.initials || "MO"}</button>
            </div>
          </div>
      </aside>

      {!externalCollapsed && <div role="separator" aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin={180} aria-valuemax={420} aria-valuenow={expandedWidth} tabIndex={0} onKeyDown={(event) => {
        const next = event.key === "ArrowLeft" ? expandedWidth - (event.shiftKey ? 20 : 8) : event.key === "ArrowRight" ? expandedWidth + (event.shiftKey ? 20 : 8) : event.key === "Home" ? 180 : event.key === "End" ? 420 : null;
        if (next === null) return;
        event.preventDefault();
        const width = Math.max(180, Math.min(420, next)); setExpandedWidth(width);
        try { window.localStorage.setItem("mosaic.sidebar.width.v1", String(width)); } catch { /* Keep session state. */ }
      }} onPointerDown={(event) => { event.preventDefault(); setIsResizing(true); event.currentTarget.setPointerCapture(event.pointerId); resizeTo(event.clientX); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeTo(event.clientX); }} onPointerUp={(event) => { resizeTo(event.clientX); setIsResizing(false); event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => setIsResizing(false)} className="group z-40 -ml-1 -mr-1 flex w-2 shrink-0 touch-none cursor-col-resize items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-vscode-accent"><span className="h-full w-px bg-transparent group-hover:bg-vscode-accent group-focus-visible:bg-vscode-accent" /></div>}

      {isProfileMenuOpen && createPortal(
        <div ref={profileMenuRef} id="profile-menu" className="fixed bottom-3 left-3 z-[60] w-[min(15rem,calc(100vw-1rem))] rounded border border-vscode-border bg-vscode-panel p-3 text-vscode-text shadow-xl">
          <div className="truncate text-xs font-semibold">{user?.username || "Local profile"}</div>
          <div className="mt-1 truncate text-[10px] text-vscode-muted">{user?.email || (user?.id === "mosaic-local" ? user.workspaceName || "This device" : "Mosaic workspace")}</div>
          {onSignOut && <button type="button" onClick={() => { setIsProfileMenuOpen(false); onSignOut(); }} className="mt-3 flex w-full items-center gap-2 border-t border-vscode-border px-1 pt-2 text-left text-xs text-vscode-text hover:text-white"><LogOut size={15} /> Sign out</button>}
        </div>,
        document.body,
      )}
    </>
  );
}
