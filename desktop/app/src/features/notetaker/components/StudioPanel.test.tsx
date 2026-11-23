// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioPanel } from "./StudioPanel";
import { EchoAIProvider } from "@/features/ask-echo/components/EchoAI";
import type { UseStudioRecorderReturn } from "@/hooks/useStudioRecorder";

const recorder = {
  status: "idle",
  elapsedSeconds: 0,
  sessionId: null,
  mediaType: "audio",
  setMediaType: vi.fn(),
  sourceMode: "online_meeting",
  setSourceMode: vi.fn(),
  availableDevices: [],
  selectedDeviceId: null,
  selectDevice: vi.fn(),
  screenInfo: null,
  isSilenceDetected: false,
  localSavedPath: null,
  hasOtherTabRecording: false,
  start: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
  reset: vi.fn(),
  dismissCaptureIssue: vi.fn(),
  audioStream: null,
  recordedFile: null,
  error: null,
  captureIssue: null,
} as unknown as UseStudioRecorderReturn;

describe("Notetaker workspace", () => {
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
  afterEach(cleanup);

  const renderWorkspace = (recorderOverrides: Partial<UseStudioRecorderReturn> = {}, onSendToNotetaker = vi.fn()) => render(
    <EchoAIProvider>
      <StudioPanel
        isOpen
        embedded
        recorder={{ ...recorder, ...recorderOverrides } as UseStudioRecorderReturn}
        askEchoEnabled
        meetingDetails={<input aria-label="Meeting name" />}
        mode="fullscreen"
        onChangeMode={() => {}}
        onClose={() => {}}
        onSendToNotetaker={onSendToNotetaker}
      />
    </EchoAIProvider>,
  );

  it("keeps meeting details collapsed until the contributor opens them", () => {
    renderWorkspace();

    const summary = screen.getByText("Meeting details");
    const details = summary.closest("details");
    expect(details?.open).toBe(false);

    fireEvent.click(summary);
    expect(details?.open).toBe(true);
    expect(screen.getByRole("textbox", { name: "Meeting name" })).toBeTruthy();
  });

  it("uses clear empty-state copy and avoids a stale assistant description", () => {
    renderWorkspace();

    expect(screen.getByText("Capture decisions as they happen")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Meeting assistant" })).toBeTruthy();
    expect(screen.queryByText("Review previous meetings while this one is being captured.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset conversation" })).toBeNull();
  });

  it("lets a small-screen user switch panels without losing an unsent note", () => {
    renderWorkspace();

    const panelSwitcher = within(screen.getByRole("group", { name: "Meeting workspace panels" }));
    const notesTab = panelSwitcher.getByRole("button", { name: "Notes" });
    const captureTab = panelSwitcher.getByRole("button", { name: "Capture" });
    const assistantTab = panelSwitcher.getByRole("button", { name: "Ask Echo" });
    const composer = screen.getByPlaceholderText("Write a decision, follow-up, or note…");
    fireEvent.change(composer, { target: { value: "Confirm the revised timeline" } });

    fireEvent.click(captureTab);
    expect(captureTab.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Start Audio Recording" })).toBeTruthy();
    fireEvent.click(assistantTab);
    const assistantComposer = screen.getByRole("textbox", { name: "Message Echo AI" });
    fireEvent.change(assistantComposer, { target: { value: "What did we decide?" } });
    fireEvent.click(notesTab);
    expect(notesTab.getAttribute("aria-pressed")).toBe("true");
    expect(composer).toHaveProperty("value", "Confirm the revised timeline");
    fireEvent.click(assistantTab);
    expect(assistantComposer).toHaveProperty("value", "What did we decide?");
  });

  it.each([
    { mediaType: "audio", mime: "audio/webm", preparing: "Preparing MP3 recording…", downloadLabel: "Save Audio" },
    { mediaType: "video", mime: "video/webm", preparing: "Preparing MP4 recording…", downloadLabel: "Download video copy" },
  ] as const)("keeps $mediaType recording handoff and download disabled until conversion is ready", ({ mediaType, mime, preparing, downloadLabel }) => {
    renderWorkspace({
      status: "stopped",
      mediaType,
      recordedFile: new File(["raw recording"], "recording.webm", { type: mime }),
      localSaveStatus: "saving",
      localSavedPath: null,
    });

    expect(screen.getByRole("status").textContent).toContain(preparing);
    expect(screen.getByRole("button", { name: "Send to Notetaker" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: downloadLabel }).hasAttribute("disabled")).toBe(true);
  });

  it.each([
    { mediaType: "audio", fileName: "meeting.mp3", mime: "audio/mpeg" },
    { mediaType: "video", fileName: "meeting.mp4", mime: "video/mp4" },
  ] as const)("hands the converted $mediaType file to Notetaker with its final MIME type", async ({ mediaType, fileName, mime }) => {
    const convertedFile = new File(["converted media"], fileName, { type: mime });
    const onSendToNotetaker = vi.fn();
    renderWorkspace({
      status: "stopped",
      mediaType,
      recordedFile: convertedFile,
      localSaveStatus: "saved",
      localSavedPath: `C:/Recordings/${fileName}`,
    }, onSendToNotetaker);

    fireEvent.click(screen.getByRole("button", { name: "Send to Notetaker" }));
    await waitFor(() => expect(onSendToNotetaker).toHaveBeenCalled());
    expect(onSendToNotetaker.mock.calls[0][0]).toBe(convertedFile);
    expect(onSendToNotetaker.mock.calls[0][0].type).toBe(mime);
    expect(onSendToNotetaker.mock.calls[0][0].name).toBe(fileName);
  });
});
