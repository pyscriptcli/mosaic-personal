"use client";

import React from "react";
import { createPortal } from "react-dom";
import {
  AudioLines, BriefcaseBusiness, CalendarDays, ChevronDown, ChevronLeft, ChevronRight,
  Files, LayoutGrid, LogOut, NotebookTabs, Search,
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

const activityItems = [
  { id: "explorer", label: "Explorer", icon: Files },
  { id: "search", label: "Search", icon: Search },
  { id: "meetings", label: "Meetings", icon: CalendarDays },
  { id: "notebook", label: "Notebook", icon: NotebookTabs },
  { id: "notetaker", label: "Notetaker", icon: AudioLines },
] as const;

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
  const [activeActivity, setActiveActivity] = React.useState<(typeof activityItems)[number]["id"]>("explorer");
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
  const allNavItems = [
    { id: "dashboard" as NavView, label: "Dashboard", icon: LayoutGrid },
    { id: "business-analysis" as NavView, label: "IT Projects", icon: BriefcaseBusiness },
    { id: "meetings" as NavView, label: "Meetings", icon: CalendarDays },
    { id: "notebook" as NavView, label: "Notebook", icon: NotebookTabs },
  ];
  const orderIndex = new Map((sidebarOrder || []).map((id, index) => [id, index]));
  const navItems = allNavItems.slice().sort((a, b) => (orderIndex.get(a.id) ?? allNavItems.length) - (orderIndex.get(b.id) ?? allNavItems.length)).filter((item) => Boolean(
    allowedPages?.includes(item.id) || (item.id === "notebook" && allowedPages?.includes("tasks")),
  ));

  const chooseView = (view: NavView) => {
    setActiveActivity("explorer");
    onSelectView(view);
  };

  const renderNavItem = (item: (typeof navItems)[number]) => {
    const Icon = item.icon;
    const isActive = currentView === item.id
      || (item.id === "notebook" && currentView === "tasks")
      || (item.id === "meetings" && currentView === "minutes");
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
        className={`flex min-h-7 w-full items-center gap-1.5 border-l-2 py-1 pr-2 text-left text-[13px] transition-colors ${isActive ? "border-[#0078d4] bg-[#37373d] text-white" : "border-transparent text-[#cccccc] hover:bg-[#2a2d2e]"} focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#0078d4] ${effectiveCollapsed ? "justify-center px-0" : "pl-5"}`}
      >
        {isActive ? <ChevronDown size={13} className="shrink-0 text-[#a0a0a0]" /> : <ChevronRight size={13} className="shrink-0 text-[#a0a0a0]" />}
        <Icon size={15} className={`shrink-0 ${isActive ? "text-[#75beff]" : "text-[#bdbdbd]"}`} />
        {!effectiveCollapsed && <span className="truncate">{item.label}</span>}
      </button>
    );
  };

  const runActivity = (id: (typeof activityItems)[number]["id"]) => {
    setActiveActivity(id);
    if (id === "explorer") return;
    if (id === "search") {
      window.dispatchEvent(new Event("mosaic-open-search"));
      return;
    }
    if (id === "meetings") chooseView("meetings");
    if (id === "notebook") chooseView("notebook");
    if (id === "notetaker") chooseView("minutes");
  };

  const visibleActivityItems = activityItems.filter(({ id }) => {
    if (!allowedPages) return true;
    if (id === "explorer" || id === "search") return true;
    if (id === "meetings") return allowedPages.includes("meetings") || allowedPages.includes("minutes");
    if (id === "notebook") return allowedPages.includes("notebook") || allowedPages.includes("tasks");
    return allowedPages.includes("minutes");
  });
  const widthClass = effectiveCollapsed ? "w-12" : "w-[min(272px,calc(100vw-48px))]";
  return (
    <div
      className={`relative z-40 h-full shrink-0 transition-[width] duration-200 ease-out ${externalCollapsed ? "w-12" : "w-[min(272px,calc(100vw-48px))]"}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <aside className={`absolute inset-y-0 left-0 z-40 flex ${widthClass} overflow-hidden border-r border-[#333333] bg-[#1e1e1e] text-[#cccccc] shadow-[4px_0_12px_rgba(0,0,0,0.2)] transition-[width] duration-200 ease-out`}>
        <nav aria-label="Activity bar" className="flex w-12 shrink-0 flex-col items-center border-r border-[#333333] bg-[#181818] py-2">
          {visibleActivityItems.map(({ id, label, icon: Icon }) => {
            const active = activeActivity === id;
            return (
              <button
                key={id}
                type="button"
                aria-label={label}
                aria-current={active ? "page" : undefined}
                title={label}
                onClick={() => runActivity(id)}
                className={`relative grid h-11 w-12 shrink-0 place-items-center border-l-2 transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-inset focus-visible:outline-[#0078d4] ${active ? "border-[#cccccc] text-white" : "border-transparent text-[#858585] hover:text-white"}`}
              >
                <Icon size={24} strokeWidth={1.6} />
              </button>
            );
          })}
          <div className="mt-auto flex w-full flex-col items-center gap-1">
            {onSignOut && <button type="button" onClick={onSignOut} aria-label="Sign out" title="Sign out" className="grid h-9 w-12 place-items-center text-[#858585] hover:text-white"><LogOut size={19} /></button>}
            <button
              ref={profileButtonRef}
              type="button"
              aria-label="Open profile menu"
              aria-expanded={isProfileMenuOpen}
              aria-controls="profile-menu"
              title={user?.username || "Local profile"}
              onClick={() => setIsProfileMenuOpen((open) => !open)}
              className="mb-1 grid h-8 w-8 place-items-center rounded-full border border-[#555555] bg-[#2d2d30] text-[10px] font-semibold text-[#cccccc] hover:border-[#8a8a8a] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#0078d4]"
            >
              {user?.profilePicture ? <img src={user.profilePicture} alt="" className="h-full w-full rounded-full object-cover" /> : user?.initials || "MO"}
            </button>
          </div>
        </nav>

        {!effectiveCollapsed && (
          <section aria-label="Explorer" className="flex min-w-0 flex-1 flex-col bg-[#1e1e1e]">
            <header className="flex h-9 shrink-0 items-center justify-between px-4 text-[11px] font-semibold tracking-[0.08em] text-[#cccccc]">
              <span>EXPLORER</span>
              <button type="button" onClick={onToggleCollapse} aria-label="Collapse Explorer" title="Collapse Explorer" className="grid h-7 w-7 place-items-center text-[#858585] hover:bg-[#2a2d2e] hover:text-white"><ChevronLeft size={15} /></button>
            </header>
            <div className="flex h-8 shrink-0 items-center gap-1.5 px-3 text-[12px] font-semibold text-[#cccccc]">
              <ChevronDown size={14} className="text-[#a0a0a0]" />
              <span className="truncate uppercase">{user?.workspaceName || "Mosaic Personal"}</span>
            </div>
            <nav aria-label="Primary navigation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
              <div className="flex flex-col py-0.5">{navItems.map(renderNavItem)}</div>
            </nav>
            <div className="border-t border-[#333333] px-3 py-2 text-[11px] text-[#858585]">
              {user?.username || (user?.id === "mosaic-local" ? "Local profile" : "Workspace")}
            </div>
          </section>
        )}
      </aside>

      {isProfileMenuOpen && createPortal(
        <div ref={profileMenuRef} id="profile-menu" className="fixed bottom-3 z-[60] w-[min(15rem,calc(100vw-1rem))] rounded border border-[#3c3c3c] bg-[#252526] p-3 text-[#cccccc] shadow-xl" style={{ left: typeof window === "undefined" ? 56 : Math.max(8, Math.min(effectiveCollapsed ? 56 : 280, window.innerWidth - 256)) }}>
          <div className="truncate text-xs font-semibold">{user?.username || "Local profile"}</div>
          <div className="mt-1 truncate text-[10px] text-[#a0a0a0]">{user?.email || (user?.id === "mosaic-local" ? user.workspaceName || "This device" : "Mosaic workspace")}</div>
          {onSignOut && <button type="button" onClick={() => { setIsProfileMenuOpen(false); onSignOut(); }} className="mt-3 flex w-full items-center gap-2 border-t border-[#3c3c3c] px-1 pt-2 text-left text-xs text-[#cccccc] hover:text-white"><LogOut size={15} /> Sign out</button>}
        </div>,
        document.body,
      )}
    </div>
  );
}
