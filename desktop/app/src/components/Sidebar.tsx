"use client";

import React from "react";
import { createPortal } from "react-dom";
import { AudioLines, BriefcaseBusiness, CalendarDays, ChevronDown, ChevronRight, LayoutGrid, LogOut, NotebookTabs, Settings } from "lucide-react";

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
  const profileButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const profileMenuRef = React.useRef<HTMLDivElement | null>(null);

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

  const effectiveCollapsed = false;
  const orderIndex = new Map((sidebarOrder || []).map((id, index) => [id, index]));
  const navItems = allNavItems.slice().sort((a, b) => (orderIndex.get(a.id) ?? allNavItems.length) - (orderIndex.get(b.id) ?? allNavItems.length)).filter((item) => Boolean(
    allowedPages?.includes(item.id),
  ));

  const chooseView = (view: NavView) => {
    onSelectView(view);
  };

  return (
    <>
      <aside className="relative z-40 flex h-full w-[min(228px,38vw)] shrink-0 flex-col overflow-hidden border-r border-vscode-border bg-vscode-sidebar text-vscode-text">
          <section aria-label="Explorer" className="flex min-w-0 flex-1 flex-col bg-vscode-sidebar">
            <header className="flex h-9 shrink-0 items-center justify-between px-4 text-[11px] font-semibold tracking-[0.08em] text-vscode-text">
              <span>EXPLORER</span>
              <span aria-hidden="true" className="text-vscode-icon">···</span>
            </header>
            <div className="flex h-8 shrink-0 items-center gap-1.5 px-3 text-[12px] font-semibold text-vscode-text">
              <ChevronDown size={14} className="text-vscode-muted" />
              <span className="truncate">{user?.workspaceName || "Mosaic Personal"}</span>
            </div>
            <nav aria-label="Primary navigation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
              <div className="flex flex-col py-0.5">{navItems.map((item) => {
                const Icon = item.icon;
                const isActive = currentView === item.id;
                return <button key={item.id} type="button" onClick={() => chooseView(item.id)} onPointerEnter={() => onPreloadView?.(item.id)} onFocus={() => onPreloadView?.(item.id)} aria-current={isActive ? "page" : undefined} className={`flex min-h-8 w-full items-center gap-2 border-l-2 px-3 text-left text-[13px] transition-colors ${isActive ? "border-vscode-accent bg-vscode-selection text-vscode-text" : "border-transparent text-vscode-text hover:bg-vscode-hover"}`}><ChevronRight size={13} className="shrink-0 text-vscode-muted" /><Icon size={15} className={`shrink-0 ${isActive ? "text-vscode-accent" : "text-vscode-icon"}`} /><span className="truncate">{item.label}</span></button>;
              })}</div>
            </nav>
          </section>
          <div className="flex items-center justify-between border-t border-vscode-border px-3 py-2">
            <span className="truncate text-[11px] text-vscode-muted">{user?.username || "Local profile"}</span>
            <div className="flex items-center gap-2">
              {onSignOut && <button type="button" onClick={onSignOut} aria-label="Sign out" title="Sign out" className="text-vscode-icon hover:text-vscode-text"><LogOut size={14} /></button>}
              <button ref={profileButtonRef} type="button" aria-label="Open profile menu" aria-expanded={isProfileMenuOpen} aria-controls="profile-menu" title={user?.username || "Local profile"} onClick={() => setIsProfileMenuOpen((open) => !open)} className="grid h-6 w-6 place-items-center rounded-full border border-vscode-border bg-vscode-raised text-[9px] font-semibold text-vscode-text hover:border-vscode-icon">{user?.profilePicture ? <img src={user.profilePicture} alt="" className="h-full w-full rounded-full object-cover" /> : user?.initials || "MO"}</button>
            </div>
          </div>
      </aside>

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
