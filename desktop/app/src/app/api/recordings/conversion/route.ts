import { NextRequest, NextResponse } from "next/server";
import { controlConversionJobs, findConversionJob, isConversionPaused, listConversionJobs } from "@/lib/recordingConversion";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (jobId) {
    const job = findConversionJob(jobId);
    return job ? NextResponse.json({ job }) : NextResponse.json({ error: "Conversion job not found" }, { status: 404 });
  }
  controlConversionJobs("scan");
  return NextResponse.json({ jobs: listConversionJobs(), paused: isConversionPaused() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { action?: "pause" | "resume" | "retry" | "scan"; jobId?: string };
    if (!body.action || !["pause", "resume", "retry", "scan"].includes(body.action)) {
      return NextResponse.json({ error: "A valid conversion action is required." }, { status: 400 });
    }
    return NextResponse.json(controlConversionJobs(body.action, body.jobId));
  } catch {
    return NextResponse.json({ error: "Could not update recording conversions." }, { status: 400 });
  }
}
