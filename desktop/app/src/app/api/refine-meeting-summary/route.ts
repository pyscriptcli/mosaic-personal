import { NextRequest, NextResponse } from "next/server";
import { callGroqChatPool, getGroqMeetingApiKeys } from "@/lib/groqPool";

const refinementGuidance = {
  balanced: "Improve clarity and flow while preserving the draft's level of detail.",
  concise: "Prefer short sentences and retain only material context; do not omit decisions, dates, owners, risks, or unresolved questions.",
  "decision-focused": "Emphasize confirmed decisions, outcomes, commitments, and unresolved decisions without turning them into new facts or actions.",
  "detail-preserving": "Retain meaningful account and project details, examples, numbers, and dependencies; remove repetition only.",
} as const;

export async function POST(request: NextRequest) {
  try {
    const apiKeys = getGroqMeetingApiKeys();
    if (!apiKeys.length) {
      return NextResponse.json({ error: "Groq API keys are required. Import Groq keys in desktop Settings." }, { status: 401 });
    }

    const { summary = "", bottom_line = "", notes = "", transcript = "", refinement_style = "balanced" } = await request.json();
    const selectedGuidance = refinementGuidance[refinement_style as keyof typeof refinementGuidance] || refinementGuidance.balanced;
    const meetingNotes = String(notes).trim();
    const meetingTranscript = String(transcript).trim();
    if (!meetingNotes && !meetingTranscript) {
      return NextResponse.json({ error: "Add meeting notes or a transcript before refining the summary." }, { status: 400 });
    }

    const result = await callGroqChatPool([
      {
        role: "system",
        content: `Refine a meeting summary and bottom line. Return valid JSON only with string keys "summary" and "bottom_line". Keep the summary to one concise paragraph describing the purpose and main subjects. Keep the bottom line to one concise paragraph describing the outcome, decision, or unresolved status. Meeting notes are the primary source of truth and may contain corrections, agenda, names, projects, or context. Use the transcript to connect details and add clearly supported spoken information. Do not let the transcript override meeting notes. Preserve Taglish and names as provided. Do not invent facts, decisions, owners, or commitments. Use the existing draft as an editable starting point, removing repetition and improving clarity while preserving supported content. If a source conflict cannot be resolved from the notes, state the uncertainty clearly. Selected refinement style: ${selectedGuidance}`,
      },
      {
        role: "user",
        content: JSON.stringify({
          current_summary: String(summary),
          current_bottom_line: String(bottom_line),
          meeting_notes: meetingNotes || "No meeting notes provided.",
          transcript: meetingTranscript || "No transcript provided.",
        }),
      },
    ], {
      model: process.env.GROQ_NOTETAKER_MODEL || "openai/gpt-oss-120b",
      responseFormat: { type: "json_object" },
      apiKeys,
    });
    const content = String(result.data.choices?.[0]?.message?.content || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    const parsed = JSON.parse(content);
    return NextResponse.json({ summary: String(parsed.summary || ""), bottom_line: String(parsed.bottom_line || "") });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
