"use client";

import { useCallback, useEffect, useState } from "react";

export type DesktopUpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "unsupported"
  | "error";

export interface DesktopUpdateState {
  status: DesktopUpdateStatus;
  currentVersion: string;
  version: string | null;
  percent: number;
  bytesPerSecond?: number;
  releaseNotes?: string | null;
  error: string | null;
}

interface DesktopUpdaterBridge {
  getUpdateState: () => Promise<DesktopUpdateState>;
  checkForUpdates: () => Promise<DesktopUpdateState>;
  installUpdate: () => Promise<boolean>;
  onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
}

const initialState: DesktopUpdateState = {
  status: "idle",
  currentVersion: "",
  version: null,
  percent: 0,
  releaseNotes: null,
  error: null,
};

function getUpdaterBridge(): DesktopUpdaterBridge | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { mosaicDesktop?: DesktopUpdaterBridge }).mosaicDesktop || null;
}

export function useDesktopUpdater() {
  const [state, setState] = useState<DesktopUpdateState>(initialState);

  useEffect(() => {
    const bridge = getUpdaterBridge();
    if (!bridge) return;
    const unsubscribe = bridge.onUpdateState(setState);
    void bridge.getUpdateState().then(setState).catch((error: unknown) => {
      setState((current) => ({
        ...current,
        status: "error",
        error: error instanceof Error ? error.message : "Could not read update status.",
      }));
    });
    return unsubscribe;
  }, []);

  const checkForUpdates = useCallback(async () => {
    const bridge = getUpdaterBridge();
    if (!bridge) return;
    setState((current) => ({ ...current, status: "checking", error: null }));
    try {
      setState(await bridge.checkForUpdates());
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "error",
        error: error instanceof Error ? error.message : "Could not check for updates.",
      }));
    }
  }, []);

  const installUpdate = useCallback(async () => {
    const bridge = getUpdaterBridge();
    if (!bridge) return;
    await bridge.installUpdate();
  }, []);

  return { state, checkForUpdates, installUpdate };
}
