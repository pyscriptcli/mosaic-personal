"use client";

import React from "react";
import { createPortal } from "react-dom";
import {
  AudioLines, BriefcaseBusiness, CalendarDays, ChevronDown, ChevronLeft, ChevronRight,
  LayoutGrid, LogOut, NotebookTabs, Search,
} from "lucide-react";

export type NavView = "dashboard" | "tasks" | "notebook" | "meetings" | "minutes" | "business-analysis";

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
  const [isHovered, setIsHovered] = React.useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = React.useState(false);
  const profileButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const profileMenuRef = React.useRef<HTMLDivElement | null>(null);
  const hoverTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

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

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = null;
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => setIsHovered(false), 150);
  };

  const effectiveCollapsed = externalCollapsed && !isHovered;
  const searchItem = { id: "search" as const, label: "Search", icon: Search };
  const activeNavView = currentView === "tasks" ? "notebook" : currentView;
  const orderIndex = new Map((sidebarOrder || []).map((id, index) => [id, index]));
  const navItems = allNavItems.slice().sort((a, b) => (orderIndex.get(a.id) ?? allNavItems.length) - (orderIndex.get(b.id) ?? allNavItems.length)).filter((item) => Boolean(
    allowedPages?.includes(item.id) || (item.id === "notebook" && allowedPages?.includes("tasks")),
  ));

  const chooseView = (view: NavView) => {
    onSelectView(view);
  };

  const renderNavItem = (item: (typeof navItems)[number]) => {
    const Icon = item.icon;
    const isActive = currentView === item.id
      || (item.id === "notebook" && currentView === "tasks")
      || (item.id === "minutes" && currentView === "minutes");
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => chooseView(item.id)}
        onPointerEnter={() => onPreloadView?.(item.id)}
        onFocus={() => onPreloadView?.(item.id)}
        title={effectiveCollapsed ? item.label : undefined}
        aria-current={isActive ? "page" : undefined}
        aria-label={effectiveCollapsed ? item.label : undefined}
        className={`flex min-h-7 w-full items-center gap-1.5 border-l-2 py-1 pr-2 text-left text-[13px] transition-colors ${isActive ? "border-vscode-accent bg-vscode-selection text-vscode-text" : "border-transparent text-vscode-text hover:bg-vscode-hover"} focus-visible:outline focus-visible:outline-1 focus-visible:outline-vscode-accent ${effectiveCollapsed ? "justify-center px-0" : "pl-5"}`}
      >
        {isActive ? <ChevronDown size={13} className="shrink-0 text-vscode-muted" /> : <ChevronRight size={13} className="shrink-0 text-vscode-muted" />}
        <Icon size={15} className={`shrink-0 ${isActive ? "text-vscode-accent" : "text-vscode-icon"}`} />
        {!effectiveCollapsed && <span className="truncate">{item.label}</span>}
      </button>
    );
  };

  const openSearch = () => window.dispatchEvent(new Event("mosaic-open-search"));
  const widthClass = effectiveCollapsed ? "w-12" : "w-[min(272px,calc(100vw-48px))]";
  return (
    <div
      className={`relative z-40 h-full shrink-0 transition-[width] duration-150 ease-out ${widthClass}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <aside className={`relative z-40 flex h-full ${widthClass} overflow-hidden border-r border-vscode-border bg-vscode-sidebar text-vscode-text transition-[width] duration-150 ease-out`}>
        <nav aria-label="Activity bar" className="flex w-12 shrink-0 flex-col items-center border-r border-vscode-border bg-vscode-activity py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeNavView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                title={item.label}
                onClick={() => chooseView(item.id)}
                onPointerEnter={() => onPreloadView?.(item.id)}
                onFocus={() => onPreloadView?.(item.id)}
                className={`relative grid h-11 w-12 shrink-0 place-items-center border-l-2 transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-inset focus-visible:outline-vscode-accent ${active ? "border-vscode-text text-vscode-text" : "border-transparent text-vscode-icon hover:text-vscode-text"}`}
              >
                <Icon size={24} strokeWidth={1.6} />
              </button>
            );
          })}
          <div className="my-1 w-7 border-t border-vscode-border" />
          <button
            type="button"
            aria-label={searchItem.label}
            title={searchItem.label}
            onClick={openSearch}
            className="relative grid h-11 w-12 shrink-0 place-items-center border-l-2 border-transparent text-vscode-icon transition-colors hover:text-vscode-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-vscode-accent"
          >
            <Search size={22} strokeWidth={1.6} />
          </button>
          <div className="mt-auto flex w-full flex-col items-center gap-1">
            {onSignOut && <button type="button" onClick={onSignOut} aria-label="Sign out" title="Sign out" className="grid h-9 w-12 place-items-center text-vscode-icon hover:text-vscode-text"><LogOut size={19} /></button>}
            <button
              ref={profileButtonRef}
              type="button"
              aria-label="Open profile menu"
              aria-expanded={isProfileMenuOpen}
              aria-controls="profile-menu"
              title={user?.username || "Local profile"}
              onClick={() => setIsProfileMenuOpen((open) => !open)}
              className="mb-1 grid h-8 w-8 place-items-center rounded-full border border-vscode-border bg-vscode-raised text-[10px] font-semibold text-vscode-text hover:border-vscode-icon focus-visible:outline focus-visible:outline-1 focus-visible:outline-vscode-accent"
            >
              {user?.profilePicture ? <img src={user.profilePicture} alt="" className="h-full w-full rounded-full object-cover" /> : user?.initials || "MO"}
            </button>
          </div>
        </nav>

        {!effectiveCollapsed && (
          <section aria-label="Explorer" className="flex min-w-0 flex-1 flex-col bg-vscode-sidebar">
            <header className="flex h-9 shrink-0 items-center justify-between px-4 text-[11px] font-semibold tracking-[0.08em] text-vscode-text">
              <span>EXPLORER</span>
              <button type="button" onClick={onToggleCollapse} aria-label="Collapse Explorer" title="Collapse Explorer" className="grid h-7 w-7 place-items-center text-vscode-icon hover:bg-vscode-hover hover:text-vscode-text"><ChevronLeft size={15} /></button>
            </header>
            <div className="flex h-8 shrink-0 items-center gap-1.5 px-3 text-[12px] font-semibold text-vscode-text">
              <ChevronDown size={14} className="text-vscode-muted" />
              <span className="truncate">{user?.workspaceName || "Mosaic Personal"}</span>
            </div>
            <nav aria-label="Primary navigation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
              <div className="flex flex-col py-0.5">{navItems.map(renderNavItem)}</div>
            </nav>
            <div className="border-t border-vscode-border px-3 py-2 text-[11px] text-vscode-muted">
              {user?.username || (user?.id === "mosaic-local" ? "Local profile" : "Workspace")}
            </div>
          </section>
        )}
      </aside>

      {isProfileMenuOpen && createPortal(
        <div ref={profileMenuRef} id="profile-menu" className="fixed bottom-3 z-[60] w-[min(15rem,calc(100vw-1rem))] rounded border border-vscode-border bg-vscode-panel p-3 text-vscode-text shadow-xl" style={{ left: typeof window === "undefined" ? 56 : Math.max(8, Math.min(effectiveCollapsed ? 56 : 280, window.innerWidth - 256)) }}>
          <div className="truncate text-xs font-semibold">{user?.username || "Local profile"}</div>
          <div className="mt-1 truncate text-[10px] text-vscode-muted">{user?.email || (user?.id === "mosaic-local" ? user.workspaceName || "This device" : "Mosaic workspace")}</div>
          {onSignOut && <button type="button" onClick={() => { setIsProfileMenuOpen(false); onSignOut(); }} className="mt-3 flex w-full items-center gap-2 border-t border-vscode-border px-1 pt-2 text-left text-xs text-vscode-text hover:text-white"><LogOut size={15} /> Sign out</button>}
        </div>,
        document.body,
      )}
    </div>
  );
}
