import { beforeEach, describe, expect, it, vi } from "vitest";

const conversionService = vi.hoisted(() => ({
  control: vi.fn(),
  find: vi.fn(),
  paused: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/lib/recordingConversion", () => ({
  controlConversionJobs: conversionService.control,
  findConversionJob: conversionService.find,
  isConversionPaused: conversionService.paused,
  listConversionJobs: conversionService.list,
}));

import { GET, POST } from "./route";

describe("recording conversion route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversionService.control.mockReturnValue({ paused: false, jobs: [] });
    conversionService.find.mockReturnValue({ id: "job-1", state: "ready" });
    conversionService.paused.mockReturnValue(false);
    conversionService.list.mockReturnValue([{ id: "job-1", state: "ready" }]);
  });

  it("scans and returns conversion queue state", async () => {
    const response = await GET({ nextUrl: new URL("http://localhost/api/recordings/conversion") } as never);

    expect(conversionService.control).toHaveBeenCalledWith("scan");
    expect(await response.json()).toEqual({
      jobs: [{ id: "job-1", state: "ready" }],
      paused: false,
    });
  });

  it("returns the requested conversion job", async () => {
    const response = await GET({ nextUrl: new URL("http://localhost/api/recordings/conversion?jobId=job-1") } as never);

    expect(conversionService.find).toHaveBeenCalledWith("job-1");
    expect(await response.json()).toEqual({ job: { id: "job-1", state: "ready" } });
  });

  it("applies queue controls from the public API", async () => {
    const request = { json: async () => ({ action: "retry", jobId: "job-1" }) };

    const response = await POST(request as never);

    expect(conversionService.control).toHaveBeenCalledWith("retry", "job-1");
    expect(await response.json()).toEqual({ paused: false, jobs: [] });
  });

  it("rejects invalid queue actions", async () => {
    const response = await POST({ json: async () => ({ action: "delete" }) } as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A valid conversion action is required." });
    expect(conversionService.control).not.toHaveBeenCalled();
  });
});
