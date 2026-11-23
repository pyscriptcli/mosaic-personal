import { NextRequest, NextResponse } from "next/server";
import { callGroqChatPool, getGroqMeetingApiKeys } from "@/lib/groqPool";

export interface DiscoveredTopicItem {
  topic_title: string;
  discussion_point: string;
  evidence_quote: string;
  action_plan: string;
  indicative_delivery_date: string;
  person_in_charge: string;
  confidence: "High" | "Medium" | "Low";
}

function separateMeetingNotes(source: string, notes?: string) {
  const labeledSource = source.match(/^=== MEETING NOTES ===\s*([\s\S]*?)\s*=== TRANSCRIPT ===\s*([\s\S]*)$/i);
  return {
    meetingNotes: String(notes || "").trim() || labeledSource?.[1].trim() || "",
    transcript: labeledSource?.[2] ?? source,
  };
}

export async function POST(req: NextRequest) {
  const apiKeys = getGroqMeetingApiKeys();
  if (!apiKeys.length) return NextResponse.json({ error: "Groq API keys are required. Import Groq keys in desktop Settings." }, { status: 401 });

  try {
    const { transcript: transcriptInput, existingTopics, query, notes } = await req.json();
    const source = String(transcriptInput || "");
    const { meetingNotes, transcript } = separateMeetingNotes(source, notes);
    if (!transcript?.trim()) return NextResponse.json({ topics: [] });

    const isSearchQuery = Boolean(query && query.trim() && query.trim() !== "all important topics");

    const systemPrompt = `You are an elite corporate meeting intelligence engine for Mosaic.
${isSearchQuery ? `Search the meeting for discussion points related to "${query}".` : "Find important discussion points missing from the current minutes."}

Source authority:
- Meeting notes are the primary source of truth for agendas, attendees, correct names, project or account details, jargon, and corrections. Use them to interpret and group transcript content, and follow them when they conflict with speech recognition.
- Use the transcript to connect the dots and capture what was actually discussed. Do not invent a discussion, decision, or commitment from an agenda item alone.
- Evidence quotes and timestamps must come from the transcript only. Never present meeting notes as spoken evidence.
- Preserve the transcript's language, including Taglish. Do not translate or polish direct quotations.

Return discussion points only; never treat every discussion point as an action item.
For each topic:
1. "topic_title": A clear, concise subject for one discussion card.
2. "discussion_point": Start with one short introductory paragraph that frames the topic. Then, when distinct supporting details or outcomes exist, put each on a separate line beginning with a literal hyphen and a space. Never start with a bullet or put bullets before the introductory paragraph. If there is no distinct detail to list, keep the introductory paragraph alone. Use unescaped Markdown **bold** around key source-supported facts. Do not put literal backslashes before bullet or bold markers. Describe the topic, context, discussion, and supported decisions. Keep it separate from next steps.
3. "evidence_quote": A short, direct transcript quotation supporting the discussion, with timestamp when available.
4. "action_plan": Optional suggestion only when the transcript contains an explicit commitment or assigned next step. Otherwise use "None". Do not turn proposals, insights, or general discussion into an action.
5. "indicative_delivery_date": A date only when explicitly stated for that action; otherwise "TBD".
6. "person_in_charge": An owner only when explicitly assigned; otherwise "Unassigned". Do not infer an owner from who spoke.
7. "confidence": "High" | "Medium" | "Low" based on relevance and evidence clarity.

Do not include action plans, dates, owners, or transcript evidence inside discussion_point. Keep action suggestions in their separate fields; they are optional and are not action items until the user adds them.

Output strictly valid JSON matching this schema:
{
  "topics": [
    {
      "topic_title": string,
      "discussion_point": string,
      "evidence_quote": string,
      "action_plan": string | "None",
      "indicative_delivery_date": string,
      "person_in_charge": string,
      "confidence": "High" | "Medium" | "Low"
    }
  ]
}`;

    const userPrompt = `${isSearchQuery ? `Search Query / Focus Area: ${query.trim()}\n` : "Goal: Uncover important, uncaptured discussion points and supported decisions.\n"}Already Captured Topics: ${(existingTopics || []).join(", ") || "None yet"}\n\n<meeting_notes>\n${meetingNotes || "No meeting notes provided."}\n</meeting_notes>\n\n<transcript>\n${transcript}\n</transcript>`;

    const result = await callGroqChatPool([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], {
      model: process.env.GROQ_NOTETAKER_MODEL || "openai/gpt-oss-120b",
      responseFormat: { type: "json_object" },
      apiKeys,
    });
    const parsed = JSON.parse(String(result.data.choices?.[0]?.message?.content || "{}"));
    const rawList = Array.isArray(parsed.topics) ? parsed.topics : [];

    // Normalize keys for 100% robustness (handling legacy topic/quote keys or missing fields)
    const normalizedTopics: DiscoveredTopicItem[] = rawList.map((item: unknown) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const confidence = record.confidence;
      return {
        topic_title: String(record.topic_title || record.topic || "Discovered Topic").trim(),
        discussion_point: String(record.discussion_point || record.summary || "Detailed discussion recorded in meeting transcript.").trim(),
        evidence_quote: String(record.evidence_quote || record.quote || "").trim(),
        action_plan: String(record.action_plan || record.action || "None").trim(),
        indicative_delivery_date: String(record.indicative_delivery_date || record.target_date || record.date || "TBD").trim(),
        person_in_charge: String(record.person_in_charge || record.pic || record.owner || "Unassigned").trim(),
        confidence: confidence === "High" || confidence === "Medium" || confidence === "Low" ? confidence : "High",
      };
    });

    return NextResponse.json({ topics: normalizedTopics });
  } catch (error: unknown) {
    console.error("[Topics] discovery failed", error);
    const message = error instanceof Error ? error.message : "Unable to discover more topics right now.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
