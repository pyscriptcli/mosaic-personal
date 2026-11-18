import { NextResponse } from "next/server";

export function rejectDesktopClickUpRoute() {
  if (process.env.MOSAIC_DESKTOP_NO_LOGIN !== "1") return null;
  return NextResponse.json({ error: "This integration is unavailable in the local desktop app." }, { status: 404 });
}

export function rejectDesktopLoginRoute() {
  if (process.env.MOSAIC_DESKTOP_NO_LOGIN !== "1") return null;
  return NextResponse.json({ error: "Sign-in is disabled in the local desktop app." }, { status: 404 });
}
