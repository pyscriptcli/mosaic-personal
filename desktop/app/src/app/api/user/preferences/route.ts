import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { getLocalSetting, setLocalSetting } from "@/lib/localFirstDatabase";

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function GET(req: NextRequest) {
  if (process.env.MOSAIC_DESKTOP === "1") {
    try {
      return NextResponse.json({ preferences: getLocalSetting("user.preferences", {}) }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("[UserPreferences] Local read failed:", error);
      return NextResponse.json({ preferences: null }, { status: 500 });
    }
  }
  try {
    const user = getUserFromRequest(req);
    const email = user?.email?.toLowerCase().trim();
    if (!email) {
      return NextResponse.json({ preferences: null });
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      return NextResponse.json({ preferences: null });
    }

    let preferences = null;
    const { data, error } = await supabase
      .from("echo_user_preferences")
      .select("preferences")
      .eq("email", email)
      .maybeSingle();

    if (!error && data?.preferences) {
      preferences = data.preferences;
    }

    return NextResponse.json({ preferences });
  } catch (err: any) {
    return NextResponse.json({ preferences: null });
  }
}

export async function POST(req: NextRequest) {
  if (process.env.MOSAIC_DESKTOP === "1") {
    try {
      const body = await req.json();
      const preferences = body.preferences || body;
      if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
        return NextResponse.json({ error: "Preferences must be an object." }, { status: 400 });
      }
      setLocalSetting("user.preferences", preferences);
      return NextResponse.json({ success: true, preferences, source: "local" }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("[UserPreferences] Local write failed:", error);
      return NextResponse.json({ error: "Preferences could not be saved to this device." }, { status: 500 });
    }
  }
  try {
    const user = getUserFromRequest(req);
    const email = user?.email?.toLowerCase().trim();
    if (!email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const newPrefs = body.preferences || body;
    const supabase = getSupabaseClient();

    if (supabase) {
      let saved = false;
      try {
        const { error: upsertErr } = await supabase
          .from("echo_user_preferences")
          .upsert(
            {
              email,
              preferences: newPrefs,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "email" }
          );
        if (!upsertErr) saved = true;
      } catch (err) {
        // Ignored, fallback below
      }

    }

    return NextResponse.json({ success: true, preferences: newPrefs });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update preferences" }, { status: 500 });
  }
}
