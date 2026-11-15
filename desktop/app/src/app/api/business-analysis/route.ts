import { NextRequest, NextResponse } from "next/server";
import { authorizeBARequest, getBAStorage } from "@/features/it-projects/lib/business-analysis-server";
import { normalizeBAState } from "@/features/it-projects/lib/business-analysis";
import { getLocalSetting, setLocalSetting } from "@/lib/localFirstDatabase";

export const dynamic = "force-dynamic";
const TABLE = "mosaic_ba_workspaces";
const LOCAL_KEY = "it-projects.workspace";

export async function GET(req: NextRequest) {
  if (process.env.MOSAIC_DESKTOP === "1") {
    try {
      return NextResponse.json({ state: normalizeBAState(getLocalSetting(LOCAL_KEY, null)) }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("[IT Projects] Local load failed:", error);
      return NextResponse.json({ error: "IT Projects could not load from this device." }, { status: 500 });
    }
  }
  try {
    const { user, denied } = await authorizeBARequest(req);
    if (denied || !user) return denied;
    const { data, error } = await getBAStorage().from(TABLE).select("state").eq("owner_user_id", String(user.id)).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ state: normalizeBAState(data?.state) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[IT Projects] Load failed:", error);
    return NextResponse.json({ error: "IT Projects could not load. Check that its workspace storage is installed." }, { status: 503 });
  }
}

export async function PUT(req: NextRequest) {
  if (process.env.MOSAIC_DESKTOP === "1") {
    try {
      const raw = await req.text();
      if (raw.length > 1_000_000) return NextResponse.json({ error: "This workspace is too large to save." }, { status: 413 });
      const body = JSON.parse(raw) as { state?: unknown };
      setLocalSetting(LOCAL_KEY, normalizeBAState(body.state));
      return NextResponse.json({ saved: true, source: "local" });
    } catch (error) {
      console.error("[IT Projects] Local save failed:", error);
      return NextResponse.json({ error: "IT Projects could not save to this device." }, { status: 400 });
    }
  }
  try {
    const { user, denied } = await authorizeBARequest(req);
    if (denied || !user) return denied;
    const raw = await req.text();
    if (raw.length > 1_000_000) return NextResponse.json({ error: "This workspace is too large to save." }, { status: 413 });
    let body: { state?: unknown };
    try { body = JSON.parse(raw) as { state?: unknown }; }
    catch { return NextResponse.json({ error: "The workspace data could not be read." }, { status: 400 }); }
    const state = normalizeBAState(body.state);
    const { error } = await getBAStorage().from(TABLE).upsert({
      owner_user_id: String(user.id), owner_email: user.email.toLowerCase().trim(), state, updated_at: new Date().toISOString(),
    }, { onConflict: "owner_user_id" });
    if (error) throw error;
    return NextResponse.json({ saved: true });
  } catch (error) {
    console.error("[IT Projects] Save failed:", error);
    return NextResponse.json({ error: "IT Projects could not save. Check that its workspace storage is installed." }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  if (process.env.MOSAIC_DESKTOP === "1") {
    try {
      const body = await req.json() as { projectId?: unknown };
      const projectId = typeof body.projectId === "string" ? body.projectId.trim().slice(0, 120) : "";
      if (!projectId) return NextResponse.json({ error: "Choose a project to delete." }, { status: 400 });
      const currentState = normalizeBAState(getLocalSetting(LOCAL_KEY, null));
      if (!currentState.projects.some((project) => project.id === projectId)) {
        return NextResponse.json({ error: "This project is no longer in your workspace. Reload and try again." }, { status: 404 });
      }
      const state = { ...currentState, projects: currentState.projects.filter((project) => project.id !== projectId) };
      setLocalSetting(LOCAL_KEY, state);
      return NextResponse.json({ state, source: "local" });
    } catch (error) {
      console.error("[IT Projects] Local delete failed:", error);
      return NextResponse.json({ error: "The project could not be deleted from this device." }, { status: 500 });
    }
  }
  try {
    const { user, denied } = await authorizeBARequest(req);
    if (denied || !user) return denied;
    let body: { projectId?: unknown };
    try { body = await req.json() as { projectId?: unknown }; }
    catch { return NextResponse.json({ error: "Choose a project to delete." }, { status: 400 }); }
    const projectId = typeof body.projectId === "string" ? body.projectId.trim().slice(0, 120) : "";
    if (!projectId) return NextResponse.json({ error: "Choose a project to delete." }, { status: 400 });

    const storage = getBAStorage();
    const { data, error: readError } = await storage.from(TABLE).select("state").eq("owner_user_id", String(user.id)).maybeSingle();
    if (readError) throw readError;
    const currentState = normalizeBAState(data?.state);
    if (!currentState.projects.some((project) => project.id === projectId)) {
      return NextResponse.json({ error: "This project is no longer in your workspace. Reload and try again." }, { status: 404 });
    }

    const state = { ...currentState, projects: currentState.projects.filter((project) => project.id !== projectId) };
    const { error: writeError } = await storage.from(TABLE).upsert({
      owner_user_id: String(user.id), owner_email: user.email.toLowerCase().trim(), state, updated_at: new Date().toISOString(),
    }, { onConflict: "owner_user_id" });
    if (writeError) throw writeError;
    return NextResponse.json({ state });
  } catch (error) {
    console.error("[IT Projects] Project delete failed:", error);
    return NextResponse.json({ error: "The project could not be deleted. Try again." }, { status: 503 });
  }
}
