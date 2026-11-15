import { describe, expect, it } from "vitest";
import { navRouteForView, navViewForPath } from "./navRoutes";
import { ALL_APP_PAGES } from "./access-control";

describe("application routes", () => {
  it("maps supported views to routes", () => {
    expect(navRouteForView("dashboard")).toBe("/dashboard");
    expect(navRouteForView("business-analysis")).toBe("/it-projects");
    expect(navViewForPath("/it-projects/requirements")).toBe("business-analysis");
    expect(navViewForPath("/notebook")).toBe("notebook");
  });

  it("registers the supported application pages", () => {
    expect(ALL_APP_PAGES).toEqual(["dashboard", "tasks", "notebook", "meetings", "minutes", "business-analysis"]);
  });
});
