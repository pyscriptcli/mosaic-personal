import { NextRequest, NextResponse } from "next/server";
import { deleteLocalSetting, getLocalSetting, setLocalSetting } from "@/lib/localFirstDatabase";

export const dynamic = "force-dynamic";
const validKey = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9._:-]{1,100}$/i.test(value);

function desktopOnly() {
  return process.env.MOSAIC_DESKTOP === "1";
}

export async function GET(request: NextRequest) {
  if (!desktopOnly()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const key = request.nextUrl.searchParams.get("key");
  if (!validKey(key)) return NextResponse.json({ error: "Choose a valid setting." }, { status: 400 });
  try {
    return NextResponse.json({ value: getLocalSetting(key, null) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Local setting load failed:", error);
    return NextResponse.json({ error: "Local setting could not be loaded." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  if (!desktopOnly()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    const body = await request.json();
    if (!validKey(body.key)) return NextResponse.json({ error: "Choose a valid setting." }, { status: 400 });
    setLocalSetting(body.key, body.value);
    return NextResponse.json({ saved: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Local setting save failed:", error);
    return NextResponse.json({ error: "Local setting could not be saved." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!desktopOnly()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const key = request.nextUrl.searchParams.get("key");
  if (!validKey(key)) return NextResponse.json({ error: "Choose a valid setting." }, { status: 400 });
  try {
    return NextResponse.json({ deleted: deleteLocalSetting(key) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Local setting delete failed:", error);
    return NextResponse.json({ error: "Local setting could not be deleted." }, { status: 500 });
  }
}
