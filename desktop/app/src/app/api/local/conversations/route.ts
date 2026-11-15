import { NextRequest, NextResponse } from "next/server";
import { clearEchoConversation, getEchoConversation, saveEchoConversation } from "@/lib/localFirstDatabase";

export const dynamic = "force-dynamic";
const desktopOnly = () => process.env.MOSAIC_DESKTOP === "1";

export async function GET() {
  if (!desktopOnly()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    return NextResponse.json({ messages: getEchoConversation() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Local Echo history load failed:", error);
    return NextResponse.json({ error: "Echo history could not load from this device." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  if (!desktopOnly()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    const body = await request.json();
    if (!Array.isArray(body.messages) || body.messages.length > 500) return NextResponse.json({ error: "Conversation is invalid or too large." }, { status: 400 });
    const messages = body.messages.filter((message: unknown): message is { role: "user" | "assistant"; content: string; timestamp?: string; response?: unknown } =>
      Boolean(message && typeof message === "object" && ["user", "assistant"].includes(String((message as Record<string, unknown>).role)) && typeof (message as Record<string, unknown>).content === "string"),
    );
    saveEchoConversation(messages);
    return NextResponse.json({ saved: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Local Echo history save failed:", error);
    return NextResponse.json({ error: "Echo history could not save to this device." }, { status: 500 });
  }
}

export async function DELETE() {
  if (!desktopOnly()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    return NextResponse.json({ deleted: clearEchoConversation() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Local Echo history delete failed:", error);
    return NextResponse.json({ error: "Echo history could not be deleted from this device." }, { status: 500 });
  }
}
