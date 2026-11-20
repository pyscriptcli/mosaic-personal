const fs = require("node:fs");
const path = require("node:path");

const VERSION = 1;
const DATE_FORMAT = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/;
const MONTHS = new Map([
  ["january", 1], ["february", 2], ["march", 3], ["april", 4], ["may", 5], ["june", 6],
  ["july", 7], ["august", 8], ["september", 9], ["october", 10], ["november", 11], ["december", 12],
]);

function parseArgs(argv) {
  const options = { apply: false, reconcile: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") options.apply = true;
    else if (argument === "--reconcile") options.reconcile = true;
    else if (argument === "--source" || argument === "--workspace") options[argument.slice(2)] = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.source || !options.workspace) {
    throw new Error("Usage: node import-tasksdata.cjs --source <TasksData folder> --workspace <Mosaic folder> [--reconcile] [--apply]");
  }
  options.source = path.resolve(options.source);
  options.workspace = path.resolve(options.workspace);
  return options;
}

function parseSourceDate(value, label) {
  const match = String(value).trim().match(DATE_FORMAT);
  if (!match) throw new Error(`Invalid date in ${label}: ${value}`);
  const month = MONTHS.get(match[1].toLowerCase());
  const day = Number(match[2]);
  const year = Number(match[3]);
  const check = new Date(Date.UTC(year, (month || 1) - 1, day));
  if (!month || check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) {
    throw new Error(`Invalid date in ${label}: ${value}`);
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function localDateParts(date) {
  const match = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Invalid ISO date: ${date}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) {
    throw new Error(`Invalid ISO date: ${date}`);
  }
  return { year, month, day, weekday: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(check) };
}

function dailyFileName(date) {
  const { year, month, day, weekday } = localDateParts(date);
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
  return `${monthName} ${day}, ${year}, ${weekday}.json`;
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`Could not read ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function taskFileDate(name) {
  return parseSourceDate(name.replace(/^Task_/, "").replace(/\.json$/i, ""), name);
}

function notesFileDate(name) {
  return parseSourceDate(name.replace(/^Notes_/, "").replace(/\.txt$/i, ""), name);
}

function completed(task) {
  return task.isCompleted === true || task.isDone === true || Boolean(task.completedAt);
}

function normalizeTask(task, fileName, index, date) {
  if (!task || typeof task !== "object" || Array.isArray(task)) throw new Error(`Invalid task ${index + 1} in ${fileName}`);
  const id = String(task.id || "").trim();
  const name = String(task.title || "").trim();
  if (!id || !name) throw new Error(`Task ${index + 1} in ${fileName} needs an id and title`);
  const isCompleted = completed(task);
  return {
    ...task,
    id,
    name,
    description: String(task.details || ""),
    status: isCompleted ? "complete" : "to do",
    completed: isCompleted,
    priority: task.isHighPriority === true || String(task.priorityGroup || "").toLowerCase() === "high" ? "high" : "normal",
    dueDate: "",
    url: "",
    sourceFileDate: date,
  };
}

function existingRecord(filePath, date) {
  if (!fs.existsSync(filePath)) return null;
  const record = readJson(filePath, `existing Notebook file ${path.basename(filePath)}`);
  if (!record || typeof record !== "object" || Array.isArray(record) || !record.data || typeof record.data !== "object" || Array.isArray(record.data)) {
    throw new Error(`Existing Notebook record is invalid: ${path.basename(filePath)}`);
  }
  if (record.id !== date) throw new Error(`Existing Notebook record has the wrong date: ${path.basename(filePath)}`);
  return record;
}

function atomicWrite(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const backupPath = `${filePath}.${process.pid}.bak`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  let movedExisting = false;
  try {
    if (fs.existsSync(filePath)) {
      fs.renameSync(filePath, backupPath);
      movedExisting = true;
    }
    fs.renameSync(temporaryPath, filePath);
    if (movedExisting) fs.unlinkSync(backupPath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    if (movedExisting && !fs.existsSync(filePath) && fs.existsSync(backupPath)) fs.renameSync(backupPath, filePath);
    throw error;
  }
}

function loadImport(sourceDirectory) {
  if (!fs.existsSync(sourceDirectory) || !fs.statSync(sourceDirectory).isDirectory()) throw new Error(`TasksData folder not found: ${sourceDirectory}`);
  const names = fs.readdirSync(sourceDirectory).sort((left, right) => left.localeCompare(right));
  const deletedIds = new Set();
  for (const name of names.filter((item) => /^Task_.+\.deleted\.json$/i.test(item))) {
    const value = readJson(path.join(sourceDirectory, name), name);
    if (!Array.isArray(value)) throw new Error(`Deletion marker must contain an array: ${name}`);
    for (const item of value) if (item?.Id) deletedIds.add(String(item.Id));
  }

  const tasksByDate = new Map();
  const snapshotPreferenceByDate = new Map();
  let sourceTaskRows = 0;
  let deletedTaskRows = 0;
  let emptyTaskFiles = 0;
  for (const name of names.filter((item) => /^Task_.+\.json$/i.test(item) && !/\.deleted\.json$/i.test(item))) {
    const fileDate = taskFileDate(name);
    const value = readJson(path.join(sourceDirectory, name), name);
    if (!Array.isArray(value)) throw new Error(`Task file must contain an array: ${name}`);
    if (value.length === 0) { emptyTaskFiles += 1; continue; }
    value.forEach((task, index) => {
      sourceTaskRows += 1;
      if (!task || typeof task !== "object" || Array.isArray(task)) throw new Error(`Invalid task ${index + 1} in ${name}`);
      const id = String(task.id || "").trim();
      if (!id) throw new Error(`Task ${index + 1} in ${name} has no id`);
      if (deletedIds.has(id)) { deletedTaskRows += 1; return; }
      const date = task.carriedForwardTo ? parseSourceDate(task.carriedForwardTo, name) : fileDate;
      const targetTasks = tasksByDate.get(date) || [];
      const preferredSnapshots = snapshotPreferenceByDate.get(date) || new Map();
      const duplicateIndex = targetTasks.findIndex((item) => item.id === id);
      const isDestinationSnapshot = date === fileDate;
      if (duplicateIndex >= 0) {
        const previousIsSnapshot = preferredSnapshots.get(id);
        if (previousIsSnapshot === isDestinationSnapshot) throw new Error(`Duplicate task id ${id} appears more than once on ${date} without a destination-date snapshot to resolve it`);
        if (isDestinationSnapshot) targetTasks[duplicateIndex] = normalizeTask(task, name, index, fileDate);
      } else {
        targetTasks.push(normalizeTask(task, name, index, fileDate));
      }
      preferredSnapshots.set(id, previousIsSnapshotOr(isDestinationSnapshot, preferredSnapshots.get(id)));
      tasksByDate.set(date, targetTasks);
      snapshotPreferenceByDate.set(date, preferredSnapshots);
    });
  }

  const notesByDate = new Map();
  let emptyNoteFiles = 0;
  for (const name of names.filter((item) => /^Notes_.+\.txt$/i.test(item))) {
    const date = notesFileDate(name);
    const value = fs.readFileSync(path.join(sourceDirectory, name), "utf8").replace(/^\uFEFF/, "");
    if (!value.trim()) { emptyNoteFiles += 1; continue; }
    if (notesByDate.has(date)) throw new Error(`More than one non-empty Notes file maps to ${date}`);
    notesByDate.set(date, value);
  }

  const dates = new Set([...tasksByDate.keys(), ...notesByDate.keys()]);
  return { dates, tasksByDate, notesByDate, sourceTaskRows, deletedTaskRows, deletedIds: deletedIds.size, emptyTaskFiles, emptyNoteFiles };
}

function previousIsSnapshotOr(current, previous) {
  return previous === undefined ? current : current || previous;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.source === options.workspace || options.source.startsWith(`${options.workspace}${path.sep}`) || options.workspace.startsWith(`${options.source}${path.sep}`)) {
    throw new Error("Source and Mosaic workspace must be separate folders.");
  }
  const notebookDirectory = path.join(options.workspace, "Notebook");
  const markerPath = path.join(options.workspace, ".imports", "tasksdata-v1.json");
  const hasPreviousImport = fs.existsSync(markerPath);
  if (hasPreviousImport && !options.reconcile) throw new Error(`TasksData import already recorded at ${markerPath}`);
  if (!hasPreviousImport && options.reconcile) throw new Error(`Cannot reconcile before an import marker exists: ${markerPath}`);

  const imported = loadImport(options.source);
  fs.mkdirSync(notebookDirectory, { recursive: true });
  const records = [...imported.dates].sort().map((date) => {
    const filePath = path.join(notebookDirectory, dailyFileName(date));
    const current = existingRecord(filePath, date);
    const data = { ...(current?.data || {}), date };
    if (!data.categories || typeof data.categories !== "object" || Array.isArray(data.categories)) {
      data.categories = { client: "", admin: "", adhoc: "", meetings: "" };
    }
    if (imported.tasksByDate.has(date)) {
      const dailyTasks = imported.tasksByDate.get(date);
      data.dailyTasks = dailyTasks;
      data.tasks = dailyTasks.map((task) => ({ ...task }));
    }
    if (imported.notesByDate.has(date)) data.notes = imported.notesByDate.get(date);
    return {
      path: filePath,
      record: {
        schemaVersion: 1,
        id: date,
        feature: current?.feature === "my-day" ? "my-day" : "notebook",
        title: current?.title || `Daily Log ${date}`,
        data,
        createdAt: current?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
  });

  const result = {
    version: VERSION,
    source: options.source,
    importedAt: new Date().toISOString(),
    dates: records.length,
    tasks: [...imported.tasksByDate.values()].reduce((count, tasks) => count + tasks.length, 0),
    notes: imported.notesByDate.size,
    deletedTaskRows: imported.deletedTaskRows,
    emptyTaskFiles: imported.emptyTaskFiles,
    emptyNoteFiles: imported.emptyNoteFiles,
  };

  const operation = options.reconcile ? "Reconcile plan" : "Import plan";
  console.log(`${options.apply ? operation : "Dry run"}: ${result.tasks} tasks, ${result.notes} notes across ${result.dates} dates.`);
  console.log(`Excluded ${result.deletedTaskRows} deleted task rows; skipped ${result.emptyTaskFiles} empty task files and ${result.emptyNoteFiles} empty note files.`);
  console.log(`Target: ${notebookDirectory}`);
  if (!options.apply) { console.log("No files written. Add --apply to perform the one-time import."); return; }

  for (const item of records) atomicWrite(item.path, item.record);
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  if (options.reconcile) {
    const previous = readJson(markerPath, "existing import marker");
    atomicWrite(markerPath, { ...previous, reconciledAt: result.importedAt, myDayTasks: result.tasks });
    console.log(`Reconciliation complete. Marker updated: ${markerPath}`);
  } else {
    atomicWrite(markerPath, result);
    console.log(`Import complete. Completion marker: ${markerPath}`);
  }
}

try { main(); }
catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
