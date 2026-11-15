import { NextRequest, NextResponse } from "next/server";
import { deleteLocalRecord, isLocalFeature, listLocalRecords, saveLocalRecord } from "@/lib/localFirstDatabase";

export const dynamic = "force-dynamic";

function desktopOnly() {
  return process.env.MOSAIC_DESKTOP === "1";
}

export async function GET(request: NextRequest) {
  if (!desktopOnly()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const feature = request.nextUrl.searchParams.get("feature");
  if (!isLocalFeature(feature)) return NextResponse.json({ error: "Choose a valid feature." }, { status: 400 });
  try {
    return NextResponse.json({ records: listLocalRecords(feature) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Local record load failed:", error);
    return NextResponse.json({ error: "Local data could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!desktopOnly()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    const body = await request.json();
    if (!isLocalFeature(body.feature)) return NextResponse.json({ error: "Choose a valid feature." }, { status: 400 });
    const record = saveLocalRecord(body.feature, body);
    return NextResponse.json({ record }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Local record could not be saved." }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  if (!desktopOnly()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    const body = await request.json();
    if (!isLocalFeature(body.feature) || typeof body.id !== "string" || !body.id.trim()) {
      return NextResponse.json({ error: "Choose a valid feature and record." }, { status: 400 });
    }
    const record = saveLocalRecord(body.feature, body);
    return NextResponse.json({ record }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Local record could not be saved." }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!desktopOnly()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const feature = request.nextUrl.searchParams.get("feature");
  const id = request.nextUrl.searchParams.get("id");
  if (!isLocalFeature(feature) || !id) return NextResponse.json({ error: "Choose a valid feature and record." }, { status: 400 });
  try {
    if (!deleteLocalRecord(feature, id)) return NextResponse.json({ error: "Record not found." }, { status: 404 });
    return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Local record delete failed:", error);
    return NextResponse.json({ error: "Local record could not be deleted." }, { status: 500 });
  }
}
