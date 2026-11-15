// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

describe("Sidebar navigation", () => {
  it("shows the remaining workspaces in one flat list", () => {
    const onSelectView = vi.fn();
    render(
      <Sidebar
        currentView="dashboard"
        onSelectView={onSelectView}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
        allowedPages={["dashboard", "business-analysis", "meetings", "notebook"]}
      />,
    );

    const labels = screen.getAllByRole("button").map((button) => button.textContent?.trim()).filter(Boolean);
    expect(labels).toContain("Dashboard");
    expect(labels).toContain("IT Projects");
    expect(labels).toContain("Meetings");
    expect(labels).toContain("Notebook");
    expect(screen.queryByText("Personal Workspace")).toBeNull();
    expect(screen.queryByText("Workspaces")).toBeNull();
    expect(screen.queryByText("Tools")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /it projects/i }));
    expect(onSelectView).toHaveBeenCalledWith("business-analysis");
  });
});
