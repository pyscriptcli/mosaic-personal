import { afterEach, describe, expect, it, vi } from "vitest";
import { getGroqApiKeys, getGroqTranscriptionApiKeys } from "./groqPool";

afterEach(() => vi.unstubAllEnvs());

describe("desktop Groq key separation", () => {
  it("keeps desktop Groq credentials out of chatbot key lookup", () => {
    vi.stubEnv("MOSAIC_DESKTOP_TRANSCRIPTION_ONLY", "1");
    vi.stubEnv("GROQ_API_KEY_1", "dotenv-chat-key");
    vi.stubEnv("GROQ_TRANSCRIPTION_API_KEYS_JSON", '["stored-transcription-key"]');

    expect(getGroqApiKeys()).toEqual([]);
    expect(getGroqTranscriptionApiKeys()).toEqual(["stored-transcription-key"]);
  });

  it("retains the existing provider pool outside desktop mode", () => {
    vi.stubEnv("MOSAIC_DESKTOP_TRANSCRIPTION_ONLY", "");
    vi.stubEnv("GROQ_API_KEY_1", "web-provider-key");
    vi.stubEnv("GROQ_TRANSCRIPTION_API_KEYS_JSON", '["desktop-only-key"]');

    expect(getGroqApiKeys()).toEqual(["web-provider-key"]);
    expect(getGroqTranscriptionApiKeys()).toEqual(["web-provider-key"]);
  });
});
