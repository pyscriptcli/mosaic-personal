// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assembleRecording, saveToLocalDocuments } from "@/features/notetaker/lib/studioStorage";
import { useStudioRecorder } from "./useStudioRecorder";

vi.mock("@/features/notetaker/lib/studioStorage", () => ({
  saveChunk: vi.fn().mockResolvedValue(undefined),
  saveSessionMeta: vi.fn().mockResolvedValue(undefined),
  assembleRecording: vi.fn(),
  downloadSession: vi.fn(),
  saveToLocalDocuments: vi.fn(),
  requestPersistentStorage: vi.fn().mockResolvedValue(true),
  getInterruptedSessions: vi.fn().mockResolvedValue([]),
  exportSessionAsFile: vi.fn(),
  clearSession: vi.fn(),
}));

class FakeTrack extends EventTarget {
  readyState: MediaStreamTrackState = "live";
  onended: (() => void) | null = null;

  constructor(
    readonly kind: "audio" | "video",
    readonly label: string,
    private readonly settings: MediaTrackSettings = {},
  ) { super(); }

  getSettings() { return this.settings; }
  stop() { this.readyState = "ended"; }
}

class FakeStream {
  constructor(private readonly tracks: FakeTrack[]) {}
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
  clone() { return new FakeStream(this.tracks); }
}

const audioTrack = (label: string, noiseSuppression: boolean) => new FakeTrack("audio", label, {
  deviceId: "mic-1",
  noiseSuppression,
});

let recorderInstances: FakeMediaRecorder[] = [];
let audioContexts: FakeAudioContext[] = [];
let originalMediaDevices: PropertyDescriptor | undefined;

class FakeMediaRecorder {
  static isTypeSupported() { return true; }
  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(readonly stream: FakeStream, readonly options: MediaRecorderOptions) {
    recorderInstances.push(this);
  }

  start() { this.state = "recording"; }
  pause() { this.state = "paused"; }
  resume() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    if (this.onstop) void this.onstop();
  }
}

class FakeAudioContext {
  state: AudioContextState = "running";
  currentTime = 0;
  onstatechange: ((event: Event) => void) | null = null;
  readonly sourceStreams: FakeStream[] = [];

  constructor() { audioContexts.push(this); }
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);

  createMediaStreamDestination() {
    return { stream: new FakeStream([new FakeTrack("audio", "mixed output")]) };
  }

  createMediaStreamSource(stream: FakeStream) {
    this.sourceStreams.push(stream);
    return { connect: (target: { connect?: (destination: unknown) => unknown }) => target };
  }

  createGain() {
    return {
      gain: { value: 1, setTargetAtTime: vi.fn() },
      connect: (target: unknown) => target,
    };
  }
}

function installMediaDevices(options: { displayStream?: FakeStream } = {}) {
  const rawMic = new FakeStream([audioTrack("Test microphone", false)]);
  const cleanMic = new FakeStream([audioTrack("Test microphone", true)]);
  const getUserMedia = vi.fn()
    .mockResolvedValueOnce(rawMic)
    .mockResolvedValueOnce(cleanMic);
  const mediaDevices = {
    getUserMedia,
    getDisplayMedia: vi.fn().mockResolvedValue(options.displayStream),
    enumerateDevices: vi.fn().mockResolvedValue([]),
    getSupportedConstraints: vi.fn().mockReturnValue({ noiseSuppression: true }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: mediaDevices });
  return { mediaDevices, rawMic, cleanMic };
}

describe("useStudioRecorder capture modes", () => {
  beforeEach(() => {
    recorderInstances = [];
    audioContexts = [];
    vi.mocked(assembleRecording).mockReset();
    vi.mocked(saveToLocalDocuments).mockReset();
    originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("MediaStream", FakeStream);
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    if (originalMediaDevices) Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
    else Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("starts in-person recording with a microphone-only audio track", async () => {
    const { mediaDevices } = installMediaDevices();
    const { result } = renderHook(() => useStudioRecorder());
    act(() => result.current.setSourceMode("in_person"));

    await act(async () => { await result.current.start(); });

    expect(result.current.status).toBe("recording");
    expect(result.current.screenInfo).toMatchObject({
      hasMicAudio: true,
      hasSystemAudio: false,
      audioStatusLabel: "Mic Only (Without System Audio)",
    });
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
    expect(mediaDevices.getDisplayMedia).not.toHaveBeenCalled();
    expect(recorderInstances[0].stream.getAudioTracks()).toHaveLength(1);
    expect(recorderInstances[0].stream.getVideoTracks()).toHaveLength(0);

    act(() => result.current.pause());
    expect(result.current.status).toBe("paused");
    expect(recorderInstances[0].state).toBe("paused");

    act(() => result.current.resume());
    expect(result.current.status).toBe("recording");
    expect(recorderInstances[0].state).toBe("recording");
  });

  it("mixes shared meeting audio with the microphone for an audio-only recording", async () => {
    const displayStream = new FakeStream([
      new FakeTrack("video", "Shared monitor", { displaySurface: "monitor" }),
      new FakeTrack("audio", "Shared system audio"),
    ]);
    const { mediaDevices, rawMic, cleanMic } = installMediaDevices({ displayStream });
    const { result } = renderHook(() => useStudioRecorder());

    await act(async () => { await result.current.start(); });

    expect(mediaDevices.getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: true }));
    expect(result.current.screenInfo).toMatchObject({
      hasMicAudio: true,
      hasSystemAudio: true,
      audioStatusLabel: "With System Audio + Mic",
    });
    expect(audioContexts[0].sourceStreams).toEqual(expect.arrayContaining([rawMic, cleanMic, displayStream]));
    expect(recorderInstances[0].stream.getAudioTracks()).toHaveLength(1);
    expect(recorderInstances[0].stream.getVideoTracks()).toHaveLength(0);
  });

  it("keeps shared screen video with the mixed audio stream when video mode is selected", async () => {
    const screenVideo = new FakeTrack("video", "Shared monitor", { displaySurface: "monitor" });
    const displayStream = new FakeStream([
      screenVideo,
      new FakeTrack("audio", "Shared system audio"),
    ]);
    installMediaDevices({ displayStream });
    const { result } = renderHook(() => useStudioRecorder());
    act(() => result.current.setMediaType("video"));

    await act(async () => { await result.current.start(); });

    expect(result.current.mediaType).toBe("video");
    expect(recorderInstances[0].options.mimeType).toBe("video/webm;codecs=vp9,opus");
    expect(recorderInstances[0].stream.getVideoTracks()).toEqual([screenVideo]);
    expect(recorderInstances[0].stream.getAudioTracks()).toHaveLength(1);
  });

  it.each([
    { mediaType: "audio", mime: "audio/mpeg", fileName: "microphone.mp3", rawMime: "audio/webm" },
    { mediaType: "video", mime: "video/mp4", fileName: "screen.mp4", rawMime: "video/webm" },
  ] as const)("exposes the converted $mediaType file only after stop finishes", async ({ mediaType, mime, fileName, rawMime }) => {
    const convertedFile = new File(["validated output"], fileName, { type: mime });
    vi.mocked(assembleRecording).mockResolvedValue(new Blob(["captured chunks"], { type: rawMime }));
    vi.mocked(saveToLocalDocuments).mockResolvedValue({
      success: true,
      filePath: `C:/Recordings/${fileName}`,
      file: convertedFile,
    });
    const displayStream = new FakeStream([
      new FakeTrack("video", "Shared monitor", { displaySurface: "monitor" }),
      new FakeTrack("audio", "Shared system audio"),
    ]);
    installMediaDevices({ displayStream });
    const { result } = renderHook(() => useStudioRecorder());
    if (mediaType === "video") act(() => result.current.setMediaType("video"));

    await act(async () => { await result.current.start(); });
    expect(result.current.localSaveStatus).toBe("idle");

    act(() => result.current.stop());
    await waitFor(() => expect(result.current.localSaveStatus).toBe("saved"));

    expect(result.current.recordedFile).toBe(convertedFile);
    expect(result.current.recordedFile?.type).toBe(mime);
    expect(result.current.localSavedPath).toBe(`C:/Recordings/${fileName}`);
    expect(saveToLocalDocuments).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Blob),
      "completed",
      mediaType,
      expect.stringMatching(mediaType === "video" ? /^echo-video-.*\.webm$/ : /^echo-recording-.*\.webm$/),
    );
  });
});
