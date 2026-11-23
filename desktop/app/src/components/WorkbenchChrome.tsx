"use client";

import { useEffect, useState } from "react";
import {
  Activity, Bell, Blocks, Check, ChevronDown, CloudDownload, Command, FilePlus2,
  FolderOpen, Gauge, HelpCircle, Info, LayoutGrid, ListChecks, MessageCircle,
  NotebookTabs, Search, Settings2, Sparkles, Users, X,
} from "lucide-react";
import type { NavView } from "@/components/Sidebar";
import type { DesktopUpdateState } from "@/hooks/useDesktopUpdater";

interface WorkbenchMenuBarProps {
  viewTitle: string;
  onOpenSearch: () => void;
  onOpenUpdates: () => void;
  onNavigate: (view: NavView) => void;
}

type MenuAction = {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  separator?: boolean;
  action?: () => void;
};

export function WorkbenchMenuBar({ viewTitle, onOpenSearch, onOpenUpdates, onNavigate }: WorkbenchMenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const menus: Array<{ label: string; actions: MenuAction[] }> = [
    { label: "File", actions: [
      { label: "New meeting", shortcut: "Ctrl+N", action: () => onNavigate("minutes") },
      { separator: true, label: "" },
      { label: "Check for updates…", action: onOpenUpdates },
    ] },
    { label: "Edit", actions: [
      { label: "Undo", shortcut: "Ctrl+Z", disabled: true },
      { label: "Redo", shortcut: "Ctrl+Y", disabled: true },
      { separator: true, label: "" },
      { label: "Find", shortcut: "Ctrl+F", action: onOpenSearch },
    ] },
    { label: "Selection", actions: [
      { label: "Select All", shortcut: "Ctrl+A", disabled: true },
      { label: "Expand Selection", shortcut: "Shift+Alt+Right", disabled: true },
    ] },
    { label: "View", actions: [
      { label: "Dashboard", action: () => onNavigate("dashboard") },
      { label: "IT Projects", action: () => onNavigate("business-analysis") },
      { label: "Meetings", action: () => onNavigate("meetings") },
      { label: "Notebook", action: () => onNavigate("notebook") },
      { label: "Notetaker", action: () => onNavigate("minutes") },
    ] },
    { label: "Go", actions: [
      { label: "Go to Dashboard", action: () => onNavigate("dashboard") },
      { label: "Go to Meetings", action: () => onNavigate("meetings") },
      { label: "Search…", shortcut: "Ctrl+P", action: onOpenSearch },
    ] },
    { label: "Run", actions: [{ label: "No run configurations", disabled: true }] },
    { label: "Terminal", actions: [{ label: "Terminal is managed by Codex", disabled: true }] },
    { label: "Help", actions: [
      { label: "Check for updates…", action: onOpenUpdates },
      { label: "About Mosaic", disabled: true },
    ] },
  ];

  useEffect(() => {
    if (!openMenu) return;
    const closeMenu = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-workbench-menu]")) setOpenMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenu]);

  return (
    <header className="flex h-8 shrink-0 items-center gap-2 bg-surface-panel px-2 text-fg" aria-label="Application menu">
      <div className="flex shrink-0 items-center gap-2 pr-1">
        <Blocks aria-hidden="true" size={17} className="text-link" />
        <span className="text-xs font-semibold">Mosaic</span>
      </div>
      <nav className="flex h-full min-w-0 items-center gap-0.5" aria-label="Menu bar">
        {menus.map((menu) => (
          <div key={menu.label} data-workbench-menu className="relative h-full">
            <button
              type="button"
              aria-expanded={openMenu === menu.label}
              onClick={() => setOpenMenu((current) => current === menu.label ? null : menu.label)}
              onMouseEnter={() => { if (openMenu) setOpenMenu(menu.label); }}
              className={`h-full px-2 text-xs transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus ${openMenu === menu.label ? "bg-surface-hover" : ""}`}
            >
              {menu.label}
            </button>
            {openMenu === menu.label && (
              <div className="absolute left-0 top-full z-[80] min-w-56 border border-line bg-surface-panel py-1 shadow-xl">
                {menu.actions.map((item, index) => item.separator ? (
                  <div key={`${menu.label}-separator-${index}`} className="my-1 border-t border-line" />
                ) : (
                  <button
                    key={`${menu.label}-${item.label}`}
                    type="button"
                    disabled={item.disabled}
                    onClick={() => { item.action?.(); setOpenMenu(null); }}
                    className="flex min-h-7 w-full items-center justify-between gap-8 px-3 text-left text-xs text-fg hover:bg-surface-selected disabled:text-disabled-fg disabled:hover:bg-transparent"
                  >
                    <span>{item.label}</span>
                    {item.shortcut && <span className="text-fg-muted">{item.shortcut}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      <button
        type="button"
        onClick={onOpenSearch}
        title="Open command center"
        className="mx-auto flex h-[22px] min-w-0 w-[min(390px,34vw)] items-center justify-center gap-2 border border-line bg-surface-raised px-3 text-xs text-fg-muted hover:text-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus"
      >
        <Command aria-hidden="true" size={12} />
        <span className="truncate">{viewTitle}</span>
        <kbd className="ml-2 border border-line px-1 py-0.5 text-[10px]">Ctrl+P</kbd>
      </button>

      <button type="button" onClick={onOpenUpdates} aria-label="Check for updates" title="Check for updates" className="grid h-7 w-7 shrink-0 place-items-center text-fg-muted hover:bg-surface-hover hover:text-fg">
        <CloudDownload aria-hidden="true" size={15} />
      </button>
    </header>
  );
}

interface WorkbenchStatusBarProps {
  updateState: DesktopUpdateState;
  onOpenUpdates: () => void;
}

function updateLabel(state: DesktopUpdateState) {
  if (state.status === "checking") return "Checking for updates…";
  if (state.status === "available") return `Downloading ${state.version || "update"}…`;
  if (state.status === "downloading") return `Downloading ${state.percent}%`;
  if (state.status === "downloaded") return `Restart to update to ${state.version || "the latest version"}`;
  if (state.status === "error") return "Update check failed";
  if (state.status === "up-to-date") return "Up to date";
  return "Check for updates";
}

export function WorkbenchStatusBar({ updateState, onOpenUpdates }: WorkbenchStatusBarProps) {
  const busy = updateState.status === "checking" || updateState.status === "downloading" || updateState.status === "available";
  return (
    <footer className="flex h-6 shrink-0 items-center justify-between border-t border-line bg-surface-panel px-2 text-[11px] text-fg" aria-label="Status bar">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" onClick={onOpenUpdates} aria-label={updateLabel(updateState)} title={updateState.error || updateLabel(updateState)} className="flex h-6 shrink-0 items-center gap-1.5 px-1.5 hover:bg-scrim/15 focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus">
          {updateState.status === "up-to-date" ? <Check size={13} /> : busy ? <Activity size={13} className="animate-pulse" /> : <CloudDownload size={13} />}
          <span>{updateLabel(updateState)}</span>
        </button>
        <span className="hidden items-center gap-1 sm:inline-flex"><FolderOpen size={12} /> Mosaic Personal</span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="hidden items-center gap-1 sm:inline-flex"><ListChecks size={12} /> Local workspace</span>
        <span className="hidden items-center gap-1 md:inline-flex"><Sparkles size={12} /> Codex CLI</span>
        <span>UTF-8</span>
        <span>Windows x64</span>
        <span className="tabular-nums">{updateState.currentVersion ? `v${updateState.currentVersion}` : "Mosaic"}</span>
      </div>
    </footer>
  );
}

interface DesktopUpdateDialogProps {
  open: boolean;
  state: DesktopUpdateState;
  onClose: () => void;
  onCheck: () => void;
  onInstall: () => void;
}

function updateMessage(state: DesktopUpdateState) {
  if (state.status === "checking") return "Checking GitHub for a newer Mosaic release.";
  if (state.status === "up-to-date") return `Mosaic ${state.currentVersion} is up to date.`;
  if (state.status === "available") return `Version ${state.version} is available. The update is downloading in the background.`;
  if (state.status === "downloading") return `Downloading version ${state.version || "update"}. You can keep using Mosaic.`;
  if (state.status === "downloaded") return `Version ${state.version} is ready. Restart Mosaic to install it.`;
  if (state.status === "installing") return "Mosaic is restarting to finish the update.";
  if (state.status === "unsupported") return "Automatic updates are available in the installed Windows app.";
  if (state.status === "error") return "Mosaic could not check for updates. Check your internet connection and try again.";
  return "Mosaic checks its GitHub prereleases for updates automatically.";
}

export function DesktopUpdateDialog({ open, state, onClose, onCheck, onInstall }: DesktopUpdateDialogProps) {
  if (!open) return null;
  const canCheck = ["idle", "up-to-date", "error", "unsupported"].includes(state.status);
  const isBusy = state.status === "checking" || state.status === "downloading" || state.status === "available";
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-scrim/55 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="desktop-update-title" className="w-full max-w-md border border-line bg-surface-panel text-fg shadow-2xl">
        <header className="flex h-9 items-center justify-between border-b border-line px-3">
          <h2 id="desktop-update-title" className="text-sm font-medium">Mosaic updates</h2>
          <button type="button" onClick={onClose} aria-label="Close updates" className="grid h-7 w-7 place-items-center text-fg-muted hover:bg-surface-hover hover:text-fg"><X size={15} /></button>
        </header>
        <div className="space-y-4 p-4">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center bg-surface-selected text-fg"><CloudDownload size={17} /></div>
            <div className="min-w-0">
              <p className="text-sm font-medium">Version {state.currentVersion || "—"}</p>
              <p className="mt-1 text-xs leading-5 text-fg-muted">{updateMessage(state)}</p>
              {state.releaseNotes && <section className="mt-3 border-t border-line pt-3">
                <h3 className="mb-1 text-xs font-medium text-fg">What’s new</h3>
                <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-fg-muted">{state.releaseNotes}</p>
              </section>}
              {state.status === "error" && state.error && <p className="mt-2 break-words text-[11px] text-fg-muted">{state.error}</p>}
            </div>
          </div>
          {isBusy && <div className="h-1 overflow-hidden bg-surface-raised"><div className={`h-full bg-action transition-[width] ${state.status === "downloading" ? "" : "animate-pulse"}`} style={{ width: state.status === "downloading" ? `${state.percent}%` : "42%" }} /></div>}
          {state.status === "downloading" && <div className="text-right font-mono text-[11px] text-fg-muted">{state.percent}%</div>}
          <div className="flex justify-end gap-2 border-t border-line pt-3">
            {canCheck && <button type="button" onClick={onCheck} className="min-h-7 border border-line bg-surface-raised px-3 text-xs text-fg hover:bg-surface-hover">Check for updates</button>}
            {state.status === "downloaded" && <button type="button" onClick={onInstall} className="min-h-7 bg-action px-3 text-xs text-on-action hover:bg-action-hover">Restart to update</button>}
            <button type="button" onClick={onClose} className="min-h-7 border border-line px-3 text-xs text-fg hover:bg-surface-hover">{state.status === "downloaded" ? "Later" : "Close"}</button>
          </div>
        </div>
      </section>
    </div>
  );
}
