import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { formatEchoDate } from "@/lib/dateUtils";
import { clickUpCalendarFetch, clickUpFetch as fetch, fetchAllClickUpListTasks } from "@/lib/clickupCalendarApi";
import { WORKSPACE_STATUS_CATEGORIES, ALL_WORKSPACE_STATUSES } from "@/lib/clickupStatuses";
import { after } from "next/server";
import { recordTelemetry } from "@/lib/telemetry";
import { clickUpScope, readClickUpTaskSnapshot } from "@/lib/clickupReadStore";
import { findStagedMosaicRecord, mergeStagedClickUpTasks, readStagedMosaicRecords, scheduleMosaicWriteSync, stageMosaicWrite } from "@/lib/mosaicWriteStore";
import { randomUUID } from "node:crypto";
import { deleteLocalRecord, listLocalRecords, saveLocalRecord } from "@/lib/localFirstDatabase";

export const maxDuration = 60;

function localTask(record: ReturnType<typeof listLocalRecords>[number]) {
  const data = record.data as Record<string, unknown>;
  return {
    ...data,
    id: record.id,
    name: record.title,
    date_created: record.createdAt,
    date_updated: record.updatedAt,
    list: { id: "local" },
    status: data.status || { status: "to do", type: "open" },
    priority: data.priority ?? 3,
    url: "",
  };
}

function getClickUpCredentials(req: NextRequest) {
  const cookieToken = req.cookies.get("echo_clickup_token")?.value || "";
  const token =
    cookieToken ||
    "";
  const listId =
    req.nextUrl.searchParams.get("listId") ||
    req.headers.get("x-clickup-list-id") ||
    req.cookies.get("echo_clickup_list_id")?.value ||
    process.env.CLICKUP_DEFAULT_LIST_ID ||
    "";
  return { token: token.trim(), listId: listId.trim() };
}

interface ClickUpTaskRecord {
  id: string | number;
  name?: string;
  description?: string | null;
  description_text?: string | null;
  url?: string;
  parent?: string | number | null;
  date_created?: number | string | null;
  date_updated?: number | string | null;
  list?: { id?: number | string } | null;
  custom_fields?: Array<{ id?: string | number; name?: string; type?: string; value?: unknown }>;
  status?: { status?: string; type?: string; color?: string } | null;
  start_date?: number | string | null;
  due_date?: number | string | null;
  assignees?: Array<{
    id: string | number;
    username?: string;
    name?: string;
    initials?: string;
    profilePicture?: string | null;
    profile_picture?: string | null;
  }>;
}

// Map ClickUp priority numbers (1: Urgent, 2: High, 3: Normal, 4: Low)
function priorityToNumber(priority: string | number): number | null {
  if (typeof priority === "number") return priority;
  const p = priority?.toLowerCase() || "";
  if (p.includes("urgent")) return 1;
  if (p.includes("high")) return 2;
  if (p.includes("normal") || p.includes("medium")) return 3;
  if (p.includes("low")) return 4;
  return 3;
}

function numberToPriority(num: number | null | undefined): string {
  switch (num) {
    case 1:
      return "urgent";
    case 2:
      return "high";
    case 3:
      return "normal";
    case 4:
      return "low";
    default:
      return "normal";
  }
}

// User-specified workspace status categories

// GET: Fetch tasks, members, list statuses, or discover lists
export async function GET(req: NextRequest) {
  if (process.env.MOSAIC_DESKTOP === "1") {
    try {
      return NextResponse.json({
        tasks: listLocalRecords("tasks").map(localTask),
        listId: "local",
        listName: "This device",
        spaceName: "Local workspace",
        folderName: "",
        members: [],
        statuses: [{ status: "to do", type: "open" }, { status: "complete", type: "closed" }],
        categories: WORKSPACE_STATUS_CATEGORIES,
        syncState: "local",
        source: "local",
      }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("Local tasks load failed:", error);
      return NextResponse.json({ error: "Tasks could not load from this device." }, { status: 500 });
    }
  }
  const routeStartedAt = Date.now();
  try {
    const { token, listId } = getClickUpCredentials(req);
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    const targetListId = searchParams.get("listId") || listId;

    if (action === "discover") {
      const teamsRes = await fetch("https://api.clickup.com/api/v2/team", {
        headers: { Authorization: token },
        cache: "no-store",
      });
      if (!teamsRes.ok) {
        return NextResponse.json(
          { error: `ClickUp authentication failed (${teamsRes.status}): ${teamsRes.statusText}`, needsAuth: true },
          { status: teamsRes.status }
        );
      }
      const teamsData = await teamsRes.json();
      const discoveredLists: Array<{
        id: string;
        name: string;
        spaceId?: string;
        spaceName: string;
        folderName?: string;
        teamName: string;
      }> = [];
      const discoveredSpaces: Array<{ id: string; name: string; teamName: string }> = [];

      for (const team of teamsData.teams || []) {
        const spacesRes = await fetch(
          `https://api.clickup.com/api/v2/team/${team.id}/space`,
          { headers: { Authorization: token }, cache: "no-store" }
        );
        if (!spacesRes.ok) continue;
        const spacesData = await spacesRes.json();
        const spaces = spacesData.spaces || [];
        spaces.forEach((space: any) => discoveredSpaces.push({ id: String(space.id), name: space.name, teamName: team.name }));

        // Parallelize fetching lists and folders across all spaces in this team
        await Promise.all(
          spaces.map(async (space: any) => {
            const [folderlessRes, foldersRes] = await Promise.all([
              fetch(`https://api.clickup.com/api/v2/space/${space.id}/list`, {
                headers: { Authorization: token },
                cache: "no-store",
              }).catch(() => null),
              fetch(`https://api.clickup.com/api/v2/space/${space.id}/folder`, {
                headers: { Authorization: token },
                cache: "no-store",
              }).catch(() => null),
            ]);

            if (folderlessRes && folderlessRes.ok) {
              const folderlessData = await folderlessRes.json().catch(() => ({}));
              for (const list of folderlessData.lists || []) {
                discoveredLists.push({
                  id: String(list.id),
                  name: list.name,
                  spaceId: String(space.id),
                  spaceName: space.name,
                  teamName: team.name,
                });
              }
            }

            if (foldersRes && foldersRes.ok) {
              const foldersData = await foldersRes.json().catch(() => ({}));
              for (const folder of foldersData.folders || []) {
                for (const list of folder.lists || []) {
                  discoveredLists.push({
                    id: String(list.id),
                    name: list.name,
                    folderName: folder.name,
                    spaceId: String(space.id),
                    spaceName: space.name,
                    teamName: team.name,
                  });
                }
              }
            }
          })
        );
      }

      // Sort discovered lists by spaceName, then folderName, then list name
      discoveredLists.sort((a, b) => {
        const spaceCompare = (a.spaceName || "").localeCompare(b.spaceName || "");
        if (spaceCompare !== 0) return spaceCompare;
        const folderCompare = (a.folderName || "").localeCompare(b.folderName || "");
        if (folderCompare !== 0) return folderCompare;
        return (a.name || "").localeCompare(b.name || "");
      });

      return NextResponse.json({ lists: discoveredLists, spaces: discoveredSpaces, count: discoveredLists.length });
    }

    if (action === "space-lists") {
      const spaceId = searchParams.get("spaceId");
      if (!spaceId) {
        return NextResponse.json({ error: "spaceId is required" }, { status: 400 });
      }
      const [folderlessRes, foldersRes, spaceRes] = await Promise.all([
        fetch(`https://api.clickup.com/api/v2/space/${spaceId}/list`, { headers: { Authorization: token }, cache: "no-store" }).catch(() => null),
        fetch(`https://api.clickup.com/api/v2/space/${spaceId}/folder`, { headers: { Authorization: token }, cache: "no-store" }).catch(() => null),
        fetch(`https://api.clickup.com/api/v2/space/${spaceId}`, { headers: { Authorization: token }, cache: "no-store" }).catch(() => null),
      ]);
      const spaceData = spaceRes?.ok ? await spaceRes.json().catch(() => ({})) : {};
      const spaceName = spaceData.name || `Space ${spaceId}`;
      const lists: Array<{ id: string; name: string; folderName?: string; spaceId: string; spaceName: string }> = [];

      if (folderlessRes && folderlessRes.ok) {
        const d = await folderlessRes.json().catch(() => ({}));
        for (const l of d.lists || []) {
          lists.push({ id: String(l.id), name: l.name, spaceId, spaceName });
        }
      }
      if (foldersRes && foldersRes.ok) {
        const d = await foldersRes.json().catch(() => ({}));
        for (const f of d.folders || []) {
          for (const l of f.lists || []) {
            lists.push({ id: String(l.id), name: l.name, folderName: f.name, spaceId, spaceName });
          }
        }
      }
      return NextResponse.json({ lists, space: { id: spaceId, name: spaceName } });
    }

    // Default action: Fetch tasks from targetListId
    if (!targetListId) {
      return NextResponse.json(
        {
          error:
            "No ClickUp List selected. Please select a ClickUp list from your workspace.",
          needsListSelection: true,
        },
        { status: 400 }
      );
    }

    const scope = clickUpScope(token);
    const syncUserId = String(getUserFromRequest(req)?.id || "");
    const verifiedListResponse = await clickUpCalendarFetch(token, `https://api.clickup.com/api/v2/list/${encodeURIComponent(targetListId)}`, undefined, undefined, { skipCache: true });
    if (!verifiedListResponse.ok) {
      const status = verifiedListResponse.status;
      return NextResponse.json({ error: status === 401 ? "Your ClickUp connection has expired. Reconnect to continue." : "This account cannot access the selected ClickUp list." }, { status });
    }

    const membersUrl = `https://api.clickup.com/api/v2/list/${encodeURIComponent(targetListId)}/member`;
    let listInfoRes: Response | null;
    let listMembersRes: Response | null;
    let rawTasks: ClickUpTaskRecord[];
    [rawTasks, listInfoRes, listMembersRes] = await Promise.all([
      fetchAllClickUpListTasks<ClickUpTaskRecord>(token, targetListId),
      verifiedListResponse || clickUpCalendarFetch(token, `https://api.clickup.com/api/v2/list/${encodeURIComponent(targetListId)}`),
      clickUpCalendarFetch(token, membersUrl),
    ]);
    if (syncUserId) {
      const staged = await readStagedMosaicRecords(scope, "tasks", targetListId);
      rawTasks = mergeStagedClickUpTasks(rawTasks as unknown as Array<Record<string, unknown>>, staged) as unknown as ClickUpTaskRecord[];
    }

    // Parse list statuses & space ID
    let listStatuses: any[] = [];
    let spaceId: string | null = null;
    let listName = "";
    let spaceName = "";
    let folderName = "";
    if (listInfoRes && listInfoRes.ok) {
      try {
        const listData = await listInfoRes.json();
        listName = listData.name || "";
        if (listData.space && listData.space.id) {
          spaceId = String(listData.space.id);
          spaceName = listData.space.name || "";
        }
        if (listData.folder && listData.folder.name) {
          folderName = listData.folder.name || "";
        }
        if (listData.statuses && Array.isArray(listData.statuses)) {
          listStatuses = listData.statuses.map((s: any) => ({
            status: s.status?.toLowerCase() || "",
            label: s.status?.toUpperCase() || "",
            color: s.color || "#808080",
            type: s.type || "custom",
          }));
        }
      } catch (e) {}
    }

    // Merge ClickUp statuses with user's specific workspace statuses
    const knownStatusMap = new Map<string, any>();
    ALL_WORKSPACE_STATUSES.forEach((s) => knownStatusMap.set(s.status.toLowerCase(), s));
    listStatuses.forEach((s) => {
      knownStatusMap.set(s.status.toLowerCase(), {
        ...s,
        label: s.status.toUpperCase(),
      });
    });
    const finalStatuses = Array.from(knownStatusMap.values());

    // Parse members - RESTRICT TO THIS SPACE AND LIST ONLY
    const membersMap = new Map<string, any>();

    // 1. Fetch space members if spaceId is resolved
    if (spaceId) {
      try {
        const spaceMembersRes = await fetch(
          `https://api.clickup.com/api/v2/space/${spaceId}/member`,
          {
            headers: { Authorization: token },
            cache: "no-store",
          }
        );
        if (spaceMembersRes.ok) {
          const spaceMembersData = await spaceMembersRes.json();
          for (const m of spaceMembersData.members || []) {
            membersMap.set(String(m.id), {
              id: m.id,
              username: m.username || m.email?.split("@")[0] || "Member",
              email: m.email || "",
              initials: m.initials || m.username?.[0]?.toUpperCase() || "?",
              profilePicture: m.profilePicture || null,
            });
          }
        }
      } catch (e) {
        console.warn("Could not fetch space members:", e);
      }
    }

    // 2. Also check list-level members
    if (listMembersRes && listMembersRes.ok) {
      try {
        const membersData = await listMembersRes.json();
        for (const m of membersData.members || []) {
          membersMap.set(String(m.id), {
            id: m.id,
            username: m.username || m.email?.split("@")[0] || "Member",
            email: m.email || "",
            initials: m.initials || m.username?.[0]?.toUpperCase() || "?",
            profilePicture: m.profilePicture || null,
          });
        }
      } catch (e) {}
    }

    // Also extract assignees found in tasks themselves
    rawTasks.forEach((t: any) => {
      (t.assignees || []).forEach((a: any) => {
        if (!membersMap.has(String(a.id))) {
          membersMap.set(String(a.id), {
            id: a.id,
            username: a.username || "Member",
            email: a.email || "",
            initials: a.initials || a.username?.[0]?.toUpperCase() || "?",
            profilePicture: a.profilePicture || null,
          });
        }
      });
    });

    const members = Array.from(membersMap.values());

    // Map tasks to Mosaic standardized format
    const tasks = rawTasks.map((t: any) => {
      // Check for meeting tag (supports both 'echo' and 'echo-meeting')
      const isMeetingTask = (t.tags || []).some((tag: any) => {
        const tagName = tag.name?.toLowerCase() || "";
        return tagName === "echo" || tagName === "echo-meeting";
      });

      // Extract meeting title/context and echo_point_id from description if present
      let meetingTitle = "";
      let discussionPointId = "";
      const desc = t.text_content || t.description || "";
      
      const titleMatch =
        desc.match(/•\s*Meeting:\s*([^\n\r]+)/i) ||
        desc.match(/•\s*\*\*Meeting:\*\*\s*([^\n\r]+)/i) ||
        desc.match(/Meeting:\s*([^\n\r]+)/i) ||
        desc.match(/🔗\s*Echo Meeting:\s*([^\n\r]+)/i);
      if (titleMatch && titleMatch[1]) {
        // Strip out trailing date parenthesis like (September 9, 2026) if present
        meetingTitle = titleMatch[1].replace(/\s*\([^)]*\)$/, "").trim();
      }

      const pointMatch =
        desc.match(/<!--\s*echo_point_id:([^\s\-]+)\s*-->/i) ||
        desc.match(/\[Echo-Point-ID:\s*([^\s\]]+)\]/i);
      if (pointMatch && pointMatch[1]) {
        discussionPointId = pointMatch[1].trim();
      }

      const statusStr = t.status?.status?.toLowerCase() || "to do";
      const statusMeta = knownStatusMap.get(statusStr);

      return {
        id: t.id,
        name: t.name,
        description: desc,
        status: statusStr,
        statusColor: statusMeta?.color || t.status?.color || "#808080",
        statusType: statusMeta?.type || t.status?.type || "custom",
        priority: numberToPriority(t.priority?.id ? Number(t.priority.id) : null),
        priorityOrder: t.priority?.id || 3,
        dueDate: t.due_date ? new Date(Number(t.due_date)).toISOString() : null,
        startDate: t.start_date ? new Date(Number(t.start_date)).toISOString() : null,
        dateCreated: t.date_created ? new Date(Number(t.date_created)).toISOString() : null,
        url: t.url,
        assignees: (t.assignees || []).map((a: any) => ({
          id: a.id,
          username: a.username,
          email: a.email,
          initials: a.initials || a.username?.[0]?.toUpperCase() || "?",
          profilePicture: a.profilePicture || null,
        })),
        tags: (t.tags || []).map((tg: any) => tg.name),
        isMeetingTask,
        meetingTitle,
        discussionPointId,
        listId: targetListId,
      };
    });

    const fetchedAt = new Date().toISOString();
    const response = NextResponse.json({
      tasks,
      total: tasks.length,
      syncState: "synced",
      syncedAt: fetchedAt,
      fetchedAt,
      source: "clickup-live",
      listId: targetListId,
      listName: listName || "Active List",
      spaceName: spaceName || "",
      folderName: folderName || "",
      members,
      statuses: finalStatuses,
      categories: WORKSPACE_STATUS_CATEGORIES,
    }, { headers: {
      "Server-Timing": `clickup;dur=${Date.now() - routeStartedAt}`,
      "Cache-Control": "no-store",
      "X-ClickUp-Data-Source": "live",
      "X-Data-Synced-At": fetchedAt,
      "X-ClickUp-Sync-State": "synced",
    } });
    const durationMs = Date.now() - routeStartedAt;
    after(() => recordTelemetry({
      source: "clickup",
      operation: "tasks_route",
      processingMs: durationMs,
      success: true,
      metadata: {
        dataSource: "clickup-live",
        recordCount: tasks.length,
      },
    }));
    if (process.env.CLICKUP_PERF_LOGS === "true") console.info("[clickup-perf]", JSON.stringify({ operation: "tasks-route", source: "clickup-live", durationMs, records: tasks.length }));
    return response;
  } catch (error: any) {
    console.error("ClickUp Tasks GET error:", error);
    const durationMs = Date.now() - routeStartedAt;
    after(() => recordTelemetry({
      source: "clickup",
      operation: "tasks_route",
      processingMs: durationMs,
      success: false,
      errorCategory: "tasks_route_error",
    }));
    return NextResponse.json(
      { error: error.message || "Internal server error connecting to ClickUp" },
      { status: 500 }
    );
  }
}

// POST: Create a task in ClickUp
export async function POST(req: NextRequest) {
  if (process.env.MOSAIC_DESKTOP === "1") {
    try {
      const body = await req.json();
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return NextResponse.json({ error: "Task name is required." }, { status: 400 });
      const id = randomUUID();
      const record = saveLocalRecord("tasks", {
        id,
        title: name,
        data: { ...body, id, name, status: body.status || { status: "to do", type: "open" } },
      });
      return NextResponse.json({ success: true, task: localTask(record), local: true }, { status: 201 });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Task could not be saved." }, { status: 400 });
    }
  }
  try {
    const { token, listId } = getClickUpCredentials(req);
    const body = await req.json();
    const action = req.nextUrl.searchParams.get("action");
    const targetListId = body.listId || listId;

    if (!token) {
      return NextResponse.json(
        { error: "ClickUp API Token not configured." },
        { status: 401 }
      );
    }
    if (!targetListId) {
      return NextResponse.json(
        { error: "ClickUp List ID not configured." },
        { status: 400 }
      );
    }

    if (!body.name || !body.name.trim()) {
      return NextResponse.json(
        { error: "Task name is required." },
        { status: 400 }
      );
    }

    // Check if task with this discussionPointId already exists in this list to avoid duplicates
    if (body.discussionPointId) {
      try {
        const existingTasks = await fetchAllClickUpListTasks<Record<string, any>>(token, targetListId);
        const found = existingTasks.find((task) => {
          const description = task.text_content || task.description || "";
          return description.includes(`echo_point_id:${body.discussionPointId}`) ||
            description.includes(`[Echo-Point-ID:${body.discussionPointId}]`) ||
            task.name?.trim().toLowerCase() === body.name.trim().toLowerCase();
        });
        if (found) {
          return NextResponse.json({
            success: true,
            task: found,
            url: found.url,
            id: found.id,
            alreadyExisted: true,
            message: "Task already exists in ClickUp",
          });
        }
      } catch (checkErr) {
        console.warn("Duplicate check failed:", checkErr);
      }
    }

    // Prepare clean executive description format (no #, no *, no icons, no promotional footer)
    let description = "";
    if (body.structuredDescription || body.topic || body.evidence || body.discussion) {
      const taskTitle = body.name.trim();
      const pic = body.personInCharge || body.assigneeName || "Unassigned";
      const topic = body.topic || "Discussion Point";
      const discussion = body.discussion || body.description || "N/A";
      const evidence = body.evidence || "";
      const meetingTitle = body.meetingTitle || "Mosaic Meeting";
      const meetingDate = body.meetingDate ? formatEchoDate(body.meetingDate) : formatEchoDate(new Date());

      description = [
        `Action Item: ${taskTitle}`,
        "",
        `Person in Charge:`,
        `${pic}`,
        "",
        `Executive Context:`,
        `• Meeting: ${meetingTitle}`,
        `• Date: ${meetingDate}`,
        `• Topic: ${topic}`,
        "",
        `Discussion & Decisions:`,
        `${discussion}`,
        ...(evidence ? [
          "",
          `Evidence & Transcript Reference:`,
          `"${evidence}"`,
        ] : []),
      ].join("\n");
    } else {
      description = body.description || "";
      if (body.meetingTitle) {
        const mDate = body.meetingDate ? ` (${formatEchoDate(body.meetingDate)})` : "";
        description += `\n\nMeeting: ${body.meetingTitle}${mDate}`;
      }
    }

    const payload: Record<string, any> = {
      name: body.name.trim(),
      description,
      tags: ["echo"],
      status: body.status || "to do",
      priority: priorityToNumber(body.priority || "normal"),
    };

    if (body.dueDate) {
      payload.due_date = new Date(body.dueDate).getTime();
      payload.due_date_time = false;
    }

    if (body.assignees && Array.isArray(body.assignees) && body.assignees.length > 0) {
      payload.assignees = body.assignees;
    }

    const userId = String(getUserFromRequest(req)?.id || "");
    if (!userId) return NextResponse.json({ error: "Reconnect ClickUp before creating a task." }, { status: 401 });
    const localTaskId = randomUUID();
    const localTask = {
      id: localTaskId,
      name: payload.name,
      description: payload.description,
      tags: payload.tags.map((name: string) => ({ name })),
      status: { status: payload.status },
      priority: { id: String(payload.priority) },
      due_date: payload.due_date || null,
      assignees: (payload.assignees || []).map((id: string | number) => ({ id })),
      date_created: new Date().toISOString(),
      list: { id: targetListId },
      url: null,
    };
    await stageMosaicWrite({ token, ownerUserId: userId, domain: "tasks", recordId: localTaskId, listId: targetListId, recordData: localTask as never, operation: "create", method: "POST", resourcePath: `/list/${targetListId}/task`, requestBody: payload as never });
    scheduleMosaicWriteSync();
    return NextResponse.json({
      success: true,
      task: localTask,
      url: null,
      id: localTaskId,
      discussionPointId: body.discussionPointId,
      pendingSync: true,
    }, { status: 202 });
  } catch (error: any) {
    console.error("ClickUp Tasks POST error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create task" },
      { status: 500 }
    );
  }
}

// PUT / PATCH: Update task status, priority, due date, assignees, or name
export async function PUT(req: NextRequest) {
  if (process.env.MOSAIC_DESKTOP === "1") {
    try {
      const body = await req.json();
      const taskId = typeof body.taskId === "string" ? body.taskId : "";
      const current = taskId ? listLocalRecords("tasks").find((record) => record.id === taskId) : undefined;
      if (!current) return NextResponse.json({ error: "Task not found." }, { status: 404 });
      const data = { ...(current.data as Record<string, unknown>), ...body, id: taskId };
      delete data.taskId;
      if (body.dueDate !== undefined) data.due_date = body.dueDate ? new Date(body.dueDate).toISOString() : null;
      const record = saveLocalRecord("tasks", { id: taskId, title: String(body.name ?? current.title), data });
      return NextResponse.json({ success: true, task: localTask(record), local: true });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Task could not be saved." }, { status: 400 });
    }
  }
  try {
    const { token, listId } = getClickUpCredentials(req);
    const body = await req.json();

    if (!token) {
      return NextResponse.json(
        { error: "ClickUp API Token not configured." },
        { status: 401 }
      );
    }
    if (!body.taskId) {
      return NextResponse.json(
        { error: "Task ID is required for updates." },
        { status: 400 }
      );
    }

    const userId = String(getUserFromRequest(req)?.id || "");
    if (!userId) return NextResponse.json({ error: "Reconnect ClickUp before updating this task." }, { status: 401 });
    const scope = clickUpScope(token);
    const staged = await findStagedMosaicRecord(scope, "tasks", String(body.taskId));
    const taskId = String(staged?.clickup_id || body.taskId);
    if (staged && !staged.clickup_id) {
      if (String(staged.owner_user_id) !== userId) return NextResponse.json({ error: "This task is not available to your account." }, { status: 403 });
    } else {
    }

    const payload: Record<string, any> = {};
    if (body.status !== undefined) payload.status = body.status;
    if (body.name !== undefined) payload.name = body.name;
    if (body.description !== undefined) payload.description = body.description;
    if (body.priority !== undefined) {
      payload.priority = priorityToNumber(body.priority);
    }
    if (body.dueDate !== undefined) {
      payload.due_date = body.dueDate ? new Date(body.dueDate).getTime() : null;
    }
    if (body.assignees !== undefined && Array.isArray(body.assignees)) {
      payload.assignees = {
        add: body.assignees,
      };
    }

    const previous = staged?.record_data && typeof staged.record_data === "object" ? staged.record_data as Record<string, unknown> : {};
    const projected: Record<string, unknown> = { ...previous, id: taskId };
    if (body.name !== undefined) projected.name = String(body.name);
    if (body.description !== undefined) projected.description = String(body.description);
    if (body.status !== undefined) projected.status = { ...(previous.status && typeof previous.status === "object" ? previous.status as Record<string, unknown> : {}), status: String(body.status) };
    if (body.priority !== undefined) projected.priority = { id: String(payload.priority) };
    if (body.dueDate !== undefined) projected.due_date = payload.due_date;
    if (Array.isArray(body.assignees)) projected.assignees = body.assignees.map((assignee: unknown) => typeof assignee === "object" && assignee ? assignee : { id: assignee });
    const listIdForSync = String(staged?.list_id || body.listId || req.cookies.get("echo_clickup_list_id")?.value || listId || "");
    await stageMosaicWrite({ token, ownerUserId: userId, domain: "tasks", recordId: String(staged?.record_id || body.taskId), listId: listIdForSync, recordData: projected as never, operation: "update", method: "PUT", resourcePath: `/task/${taskId}`, requestBody: payload as never });
    scheduleMosaicWriteSync();
    return NextResponse.json({ success: true, task: projected, pendingSync: true }, { status: 202 });
  } catch (error: any) {
    console.error("ClickUp Tasks PUT error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update task" },
      { status: 500 }
    );
  }
}

// DELETE: Delete or archive task
export async function DELETE(req: NextRequest) {
  if (process.env.MOSAIC_DESKTOP === "1") {
    const taskId = req.nextUrl.searchParams.get("taskId") || "";
    if (!taskId) return NextResponse.json({ error: "Task ID is required." }, { status: 400 });
    try {
      if (!deleteLocalRecord("tasks", taskId)) return NextResponse.json({ error: "Task not found." }, { status: 404 });
      return NextResponse.json({ success: true, local: true });
    } catch (error) {
      console.error("Local task delete failed:", error);
      return NextResponse.json({ error: "Task could not be deleted from this device." }, { status: 500 });
    }
  }
  try {
    const { token, listId } = getClickUpCredentials(req);
    const { searchParams } = new URL(req.url);
    const taskId = searchParams.get("taskId");

    if (!token) {
      return NextResponse.json(
        { error: "ClickUp API Token not configured." },
        { status: 401 }
      );
    }
    if (!taskId) {
      return NextResponse.json(
        { error: "Task ID is required." },
        { status: 400 }
      );
    }

    const userId = String(getUserFromRequest(req)?.id || "");
    if (!userId) return NextResponse.json({ error: "Reconnect ClickUp before deleting this task." }, { status: 401 });
    const staged = await findStagedMosaicRecord(clickUpScope(token), "tasks", taskId);
    const remoteId = String(staged?.clickup_id || taskId);
    if (staged && !staged.clickup_id) {
      if (String(staged.owner_user_id) !== userId) return NextResponse.json({ error: "This task is not available to your account." }, { status: 403 });
    }
    const listIdForSync = String(staged?.list_id || req.cookies.get("echo_clickup_list_id")?.value || listId || "");
    const recordData = staged?.record_data && typeof staged.record_data === "object" ? staged.record_data : { id: remoteId };
    await stageMosaicWrite({ token, ownerUserId: userId, domain: "tasks", recordId: String(staged?.record_id || taskId), listId: listIdForSync, recordData: recordData as never, operation: "delete", method: "DELETE", resourcePath: `/task/${remoteId}`, requestBody: {} });
    scheduleMosaicWriteSync();
    return NextResponse.json({ success: true, pendingSync: true }, { status: 202 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to delete task" },
      { status: 500 }
    );
  }
}
