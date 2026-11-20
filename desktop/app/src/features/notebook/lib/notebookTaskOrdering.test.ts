import { describe, expect, it } from "vitest";
import { latestNotebookTaskSnapshots, orderNotebookTasks } from "./notebookTaskOrdering";

describe("orderNotebookTasks", () => {
  it("places High first by default and respects a saved order across priorities", () => {
    const tasks = [
      { id: "normal-a", priority: null, notebookDate: "2026-11-18" },
      { id: "high-a", priority: "high", notebookDate: "2026-11-20" },
      { id: "high-b", priority: "high", notebookDate: "2026-11-19" },
      { id: "normal-b", priority: null, notebookDate: "2026-11-20" },
    ];

    expect(orderNotebookTasks(tasks).map((task) => task.id)).toEqual(["high-b", "high-a", "normal-a", "normal-b"]);
    expect(orderNotebookTasks(tasks, ["normal-a", "high-a", "normal-b", "high-b"]).map((task) => task.id))
      .toEqual(["normal-a", "high-a", "normal-b", "high-b"]);
  });

  it("keeps new tasks after saved tasks and uses date order as the fallback", () => {
    const tasks = [
      { id: "newer", priority: null, notebookDate: "2026-11-20" },
      { id: "older", priority: null, notebookDate: "2026-11-18" },
      { id: "saved", priority: null, notebookDate: "2026-11-19" },
    ];

    expect(orderNotebookTasks(tasks, ["saved"]).map((task) => task.id)).toEqual(["saved", "older", "newer"]);
  });
});

describe("latestNotebookTaskSnapshots", () => {
  it("keeps one latest snapshot per task and respects the selected day", () => {
    const snapshots = [
      { id: "task-1", notebookDate: "2026-11-18", completed: false },
      { id: "task-2", notebookDate: "2026-11-19", completed: false },
      { id: "task-1", notebookDate: "2026-11-19", completed: true },
      { id: "task-1", notebookDate: "2026-11-21", completed: false },
    ];

    expect(latestNotebookTaskSnapshots(snapshots, "2026-11-20")).toEqual([
      { id: "task-1", notebookDate: "2026-11-19", completed: true },
      { id: "task-2", notebookDate: "2026-11-19", completed: false },
    ]);
  });
});
