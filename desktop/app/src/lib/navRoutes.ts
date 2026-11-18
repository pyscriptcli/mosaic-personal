import type { NavView } from "@/components/Sidebar";

const ROUTE_BY_VIEW: Partial<Record<NavView, string>> = {
  dashboard: "/dashboard",
  notebook: "/notebook",
  meetings: "/meetings",
  minutes: "/meetings/notetaker",
  "business-analysis": "/it-projects",
  settings: "/settings",
};

export function navRouteForView(view: NavView): string | null {
  return ROUTE_BY_VIEW[view] || null;
}

export function navViewForPath(pathname: string): NavView | null {
  const path = pathname.replace(/\/+$/, "") || "/";

  if (path === "/" || path === "/dashboard" || path.startsWith("/dashboard/")) return "dashboard";
  if (path === "/tasks" || path.startsWith("/tasks/")) return "notebook";
  if (path === "/notebook" || path.startsWith("/notebook/")) return "notebook";
  if (path === "/meetings/notetaker" || path.startsWith("/meetings/notetaker/") || path === "/notetaker" || path.startsWith("/notetaker/") || path === "/minutes" || path.startsWith("/minutes/")) return "minutes";
  if (path === "/meetings" || path.startsWith("/meetings/")) return "meetings";
  if (path === "/ba" || path.startsWith("/ba/") || path === "/business-analysis" || path.startsWith("/business-analysis/") || path === "/it-projects" || path.startsWith("/it-projects/")) return "business-analysis";
  if (path === "/settings" || path.startsWith("/settings/")) return "settings";
  return null;
}
