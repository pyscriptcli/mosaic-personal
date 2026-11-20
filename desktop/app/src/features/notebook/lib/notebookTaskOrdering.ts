export type NotebookOrderedTask = {
  id: string;
  priority?: string | null;
  notebookDate?: string;
};

export function latestNotebookTaskSnapshots<T extends { id: string; notebookDate: string }>(tasks: T[], throughDate?: string): T[] {
  const latest = new Map<string, T>();
  for (const task of tasks) {
    if (throughDate && task.notebookDate > throughDate) continue;
    const existing = latest.get(task.id);
    if (!existing || task.notebookDate >= existing.notebookDate) latest.set(task.id, task);
  }
  return [...latest.values()];
}

export function orderNotebookTasks<T extends NotebookOrderedTask>(tasks: T[], orderedIds: string[] = []): T[] {
  const positions = new Map(orderedIds.map((id, index) => [id, index]));
  return tasks.map((task, index) => ({ task, index })).sort((left, right) => {
    const leftOrder = positions.get(left.task.id);
    const rightOrder = positions.get(right.task.id);
    if (leftOrder !== undefined && rightOrder !== undefined && leftOrder !== rightOrder) return leftOrder - rightOrder;
    const leftPriority = left.task.priority === "high" ? 0 : 1;
    const rightPriority = right.task.priority === "high" ? 0 : 1;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    if (leftOrder !== undefined || rightOrder !== undefined) {
      if (leftOrder === undefined) return 1;
      if (rightOrder === undefined) return -1;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    }
    const dateOrder = String(left.task.notebookDate || "").localeCompare(String(right.task.notebookDate || ""));
    return dateOrder || left.index - right.index;
  }).map(({ task }) => task);
}
