export function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function isNotebookWeekday(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  const normalized = localDateString(date);
  return normalized === value && date.getDay() !== 0 && date.getDay() !== 6;
}

export function shiftNotebookWeekday(value: string, weekdays: number) {
  const date = new Date(`${value}T12:00:00`);
  const direction = weekdays < 0 ? -1 : 1;
  let remaining = Math.abs(weekdays);

  while (remaining > 0) {
    date.setDate(date.getDate() + direction);
    if (date.getDay() !== 0 && date.getDay() !== 6) remaining -= 1;
  }

  return localDateString(date);
}

export function currentNotebookDate() {
  const today = localDateString();
  return isNotebookWeekday(today) ? today : shiftNotebookWeekday(today, 1);
}

export function notebookTaskOccurrence(task: object, date: string, today: string) {
  if (!isNotebookWeekday(date)) return null;

  const fields = task as Record<string, unknown>;
  const status = String(fields.status || "");
  const completed = fields.completed === true || /^(complete|completed|closed|done)$/i.test(status);
  const completedDate = String(fields.completedDate || (completed ? fields.notebookDate || "" : ""));
  const scheduledDate = String(fields.scheduledDate || fields.notebookDate || "");
  const dueDate = typeof fields.dueDate === "string" && isNotebookWeekday(fields.dueDate) ? fields.dueDate : "";

  if (completed && completedDate < date) return null;
  if (completed && completedDate === date) return { completed: true, carriedForward: false };

  if (date > today) {
    if (scheduledDate === date || dueDate === date) return { completed: false, carriedForward: false };
    return null;
  }

  if (scheduledDate <= date || dueDate === date) {
    return { completed: false, carriedForward: scheduledDate < date && dueDate !== date };
  }

  return null;
}
