"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowLeft, ArrowUpRight, Bold, BookOpen, Check, Download, Eye, FilePlus2, FileText, FolderKanban, LayoutGrid, List, ListOrdered, LoaderCircle, MessageSquareMore, MoreHorizontal, Plus, Printer, RefreshCw, Save, Sparkles, Table2, Tags, Trash2, X } from "lucide-react";
import { BA_MIN_COLUMN_WIDTHS, createBAProject, DEFAULT_BA_COLUMN_WIDTHS, EMPTY_BA_STATE, nextRequirementId, normalizeBAState, requirementsFromNotes } from "@/features/it-projects/lib/business-analysis";
import type { ArchivedMeeting } from "@/features/meetings/types/meeting";
import type { BAProject, BARequirement, BARequirementTask, BAWorkspaceState, BADocument, RequirementCategory, MoscowPriority, VerificationStatus } from "@/features/it-projects/types/business-analysis";
import { ITProjectSections } from "@/features/it-projects/components/ITProjectSections";
import { useEchoAI } from "@/features/ask-echo/components/EchoAI";


const CATEGORIES: RequirementCategory[] = ["Functional", "Non-Functional", "Technical", "Compliance", "Business"];
const PRIORITIES: MoscowPriority[] = ["Must Have", "Should Have", "Could Have", "Won't Have"];
const STATUSES: VerificationStatus[] = ["Passed", "In Dev", "Not Tested", "Blocked"];
type ClickUpTaskList = { id: string; name: string; teamName: string; spaceName: string; folderName: string };
type ClickUpSaveTarget = { projectId: string; requirementId: string; taskId: string; taskName: string; requirement: string };
type GrillTurn = { question: string; answer: string };
type GrillSession = { requirementId: string; statement: string; turns: GrillTurn[]; question: string; answerDraft: string; refinedStatement: string; loading: boolean; error: string; errorStage: "question" | "refine" | "" };
const PRE_DOC_TEMPLATES = ["Project Charter", "Business Case", "Business Requirements Document", "Functional Requirements Document", "UAT Test Plan"];
const POST_DOC_TEMPLATES = ["Stakeholder Sign-Off Certificate", "Production Release Notes", "Post-Implementation Review"];
const DOC_TEMPLATES = [...PRE_DOC_TEMPLATES, ...POST_DOC_TEMPLATES];
const categoryColor: Record<RequirementCategory, string> = {
  Functional: "bg-info-surface text-fg", "Non-Functional": "bg-special-surface text-special-fg",
  Technical: "bg-info-surface text-info-fg", Compliance: "bg-warning-surface text-warning-fg", Business: "bg-success-surface text-success-fg",
};
const priorityColor: Record<MoscowPriority | "", string> = {
  "Must Have": "bg-danger-surface text-danger-fg", "Should Have": "bg-warning-surface text-warning-fg",
  "Could Have": "bg-info-surface text-fg-secondary", "Won't Have": "bg-surface-raised text-fg-secondary", "": "bg-surface-panel text-fg-muted",
};
const verificationColor: Record<VerificationStatus, string> = {
  Passed: "bg-success-surface text-success-fg", "In Dev": "bg-warning-surface text-warning-fg",
  "Not Tested": "bg-surface-raised text-fg-secondary", Blocked: "bg-danger-surface text-danger-fg",
};
const cardSectionLabelClass = "text-[10px] font-semibold uppercase tracking-wide text-fg-muted";
const cellSelectClass = "h-7 w-full border border-transparent px-1 text-xs hover:border-line focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus";
const cardSelectClass = "h-7 border border-transparent px-1 text-xs hover:border-line focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus";
const timestampText = (value: string) => {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";
};

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function markdownToHtml(value: string) {
  if (!value.trim()) return "";
  const lines = value.split(/\r?\n/);
  const html: string[] = [];
  let list: "ul" | "ol" | "" = "";
  const closeList = () => { if (list) html.push(`</${list}>`); list = ""; };
  const inline = (text: string) => escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  for (const line of lines) {
    const unordered = line.match(/^\s*[-*•]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    const nextList = unordered ? "ul" : ordered ? "ol" : "";
    if (nextList) {
      if (list !== nextList) { closeList(); list = nextList; html.push(`<${list}>`); }
      html.push(`<li>${inline((unordered || ordered)![1])}</li>`);
    } else {
      closeList();
      html.push(`<div>${inline(line) || "<br>"}</div>`);
    }
  }
  closeList();
  return html.join("");
}

function editorToMarkdown(root: HTMLElement) {
  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (!(node instanceof HTMLElement)) return "";
    if (node.tagName === "BR") return "\n";
    const content = Array.from(node.childNodes, inline).join("");
    if (node.tagName === "STRONG" || node.tagName === "B") return `**${content}**`;
    return content;
  };
  const blocks = Array.from(root.childNodes).map((node) => {
    if (node instanceof HTMLElement && (node.tagName === "UL" || node.tagName === "OL")) {
      const ordered = node.tagName === "OL";
      return Array.from(node.children).filter((item) => item.tagName === "LI").map((item, index) => `${ordered ? `${index + 1}.` : "-"} ${inline(item).trim()}`).join("\n");
    }
    return inline(node).trim();
  });
  return blocks.filter(Boolean).join("\n").replace(/\n{3,}/g, "\n\n");
}

type RichTextEditorProps = { value: string; onChange: (value: string) => void; label: string; placeholder: string; className?: string };

function RichTextEditor({ value, onChange, label, placeholder, className = "" }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && document.activeElement !== editor) editor.innerHTML = markdownToHtml(value);
  }, [value]);

  const applyFormat = (command: "bold" | "insertUnorderedList" | "insertOrderedList") => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(command);
    onChange(editorToMarkdown(editor));
  };
  const handleInput = () => { if (editorRef.current) onChange(editorToMarkdown(editorRef.current)); };

  return <div className={`min-w-0 overflow-hidden border border-line bg-surface-panel focus-within:border-focus ${className}`}>
    <div role="toolbar" aria-label={`${label} formatting`} className="flex h-7 items-center gap-0.5 border-b border-line px-1">
      {[{ command: "bold" as const, label: "Bold", Icon: Bold }, { command: "insertUnorderedList" as const, label: "Bulleted list", Icon: List }, { command: "insertOrderedList" as const, label: "Numbered list", Icon: ListOrdered }].map(({ command, label: formatLabel, Icon }) => <button key={command} type="button" title={formatLabel} aria-label={`${label}: ${formatLabel}`} className="inline-flex h-5 w-6 items-center justify-center text-fg-secondary hover:bg-surface-hover hover:text-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus" onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat(command)}><Icon aria-hidden="true" size={12} /></button>)}
    </div>
    <div ref={editorRef} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={label} data-placeholder={placeholder} className="ba-rich-editor min-h-8 w-full whitespace-pre-wrap break-words px-2 py-1 text-xs leading-5 text-fg focus:outline-none [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-bold [&_ul]:list-disc [&_ul]:pl-5" onInput={handleInput} onBlur={handleInput} onPaste={(event) => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); handleInput(); }} />
  </div>;
}

function RichTextPreview({ value, className = "" }: { value: string; className?: string }) {
  return <div className={`whitespace-pre-wrap break-words [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-bold [&_ul]:list-disc [&_ul]:pl-5 ${className}`} dangerouslySetInnerHTML={{ __html: markdownToHtml(value) }} />;
}

function RequirementGenerationActions({ label, generating, onGenerate, onGrill, grillDisabled = false }: { label: string; generating: boolean; onGenerate: (customPrompt?: string) => void; onGrill: () => void; grillDisabled?: boolean }) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const optionsButtonRef = useRef<HTMLButtonElement>(null);
  const iconButtonClass = "inline-flex h-6 w-6 shrink-0 items-center justify-center border border-line text-fg-secondary hover:border-warning-border hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-wait ";

  useEffect(() => {
    if (!promptOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !popoverRef.current?.contains(event.target) && !optionsButtonRef.current?.contains(event.target)) setPromptOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setPromptOpen(false); optionsButtonRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [promptOpen]);

  return <div className="relative inline-flex shrink-0 items-center gap-1">
    <button type="button" title={`Generate ${label.toLowerCase()} with AI`} aria-label={`Generate ${label.toLowerCase()} for this requirement`} className={iconButtonClass} disabled={generating} onClick={() => onGenerate()}>{generating ? <LoaderCircle aria-hidden="true" size={13} className="animate-spin" /> : <Sparkles aria-hidden="true" size={13} />}</button>
    <button ref={optionsButtonRef} type="button" title={`More options for ${label.toLowerCase()}`} aria-label={`More options for ${label.toLowerCase()}`} aria-expanded={promptOpen} aria-haspopup="dialog" className={iconButtonClass} disabled={generating} onClick={() => setPromptOpen((open) => !open)}><MoreHorizontal aria-hidden="true" size={15} /></button>
    {promptOpen && <div ref={popoverRef} role="dialog" aria-label={`${label} generation options`} className="absolute right-0 top-full z-20 mt-1 w-64 border border-line bg-surface-panel p-2 shadow-md">
      <button type="button" className="mb-2 inline-flex h-7 w-full items-center gap-1.5 border-b border-line px-1 pb-2 text-left text-[11px] font-semibold text-fg hover:text-fg-secondary disabled:cursor-not-allowed " disabled={grillDisabled || generating} onClick={() => { setPromptOpen(false); onGrill(); }}><MessageSquareMore aria-hidden="true" size={13} />Grill me about this requirement</button>
      <label className="block text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Custom prompt<textarea rows={3} maxLength={1200} value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} placeholder={`Add instructions for ${label.toLowerCase()}`} className="mt-1 w-full resize-y border border-line bg-surface-panel px-2 py-1.5 text-xs font-normal normal-case tracking-normal text-fg focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus" /></label>
      <div className="mt-1 flex justify-end"><button type="button" className="inline-flex h-7 items-center border border-link bg-action px-2 text-[10px] font-semibold text-on-action disabled:cursor-not-allowed " disabled={!customPrompt.trim() || generating} onClick={() => { onGenerate(customPrompt.trim()); setPromptOpen(false); }}>Generate</button></div>
    </div>}
  </div>;
}

function RequirementClassificationAction({ requirementId, generating, onClassify, disabled = false }: { requirementId: string; generating: boolean; onClassify: () => void; disabled?: boolean }) {
  return <button type="button" title="Suggest category, priority, and business impact" aria-label={`Suggest category, priority, and business impact for ${requirementId}`} className="inline-flex h-6 w-6 shrink-0 items-center justify-center border border-line text-fg-secondary hover:border-warning-border hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed " disabled={generating || disabled} onClick={onClassify}>{generating ? <LoaderCircle aria-hidden="true" size={13} className="animate-spin" /> : <Tags aria-hidden="true" size={13} />}</button>;
}

function RequirementTaskRow({ requirementId, task, onUpdate, onRemove, onSaveToClickUp, savingToClickUp }: { requirementId: string; task: BARequirementTask; onUpdate: (changes: Partial<BARequirementTask>) => void; onRemove: () => void; onSaveToClickUp: () => void; savingToClickUp: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const clickUpUrl = task.clickUpTask?.url || (task.clickUpTask ? `https://app.clickup.com/t/${encodeURIComponent(task.clickUpTask.id)}` : "");
  return <div className="flex min-w-0 items-center gap-2 border border-line px-2 py-1">
    <input type="checkbox" aria-label={`${requirementId} task completed`} className="h-3.5 w-3.5 shrink-0 accent-link" checked={task.done} onChange={(event) => onUpdate({ done: event.target.checked })} />
    <input aria-label={`${requirementId} task`} className={`h-7 min-w-0 flex-1 border border-transparent bg-transparent px-1 text-xs text-fg outline-none hover:border-line focus:border-focus focus:bg-surface-panel ${task.done ? "text-fg-muted line-through" : ""}`} value={task.title} onChange={(event) => onUpdate({ title: event.target.value })} placeholder="Describe a task" />
    {task.clickUpTask && <a href={clickUpUrl} target="_blank" rel="noreferrer" title={`Saved in ${task.clickUpTask.listName}`} aria-label={`Open ClickUp task ${task.clickUpTask.id}`} className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-fg-secondary hover:text-fg"><ArrowUpRight aria-hidden="true" size={13} /></a>}
    <div className="relative shrink-0"><button type="button" title="Task options" aria-label={`Task options for ${requirementId}`} aria-expanded={menuOpen} className="inline-flex h-6 w-6 items-center justify-center border border-line text-fg-secondary hover:border-warning-border hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus" onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal aria-hidden="true" size={14} /></button>
      {menuOpen && <div className="absolute right-0 top-full z-20 mt-1 min-w-40 border border-line bg-surface-panel p-1 shadow-md">{task.clickUpTask ? <a href={clickUpUrl} target="_blank" rel="noreferrer" className="block px-2 py-1.5 text-left text-[11px] text-fg hover:bg-surface-hover">Open ClickUp task</a> : <button type="button" className="block w-full px-2 py-1.5 text-left text-[11px] text-fg hover:bg-surface-hover " disabled={!task.title.trim() || savingToClickUp} onClick={() => { setMenuOpen(false); onSaveToClickUp(); }}>{savingToClickUp ? "Saving…" : "Save to ClickUp"}</button>}</div>}
    </div>
    <button type="button" title="Remove task" aria-label={`Remove task from ${requirementId}`} className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-fg-muted hover:text-danger-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus" onClick={onRemove}><X aria-hidden="true" size={13} /></button>
  </div>;
}

type RequirementCardProps = {
  requirement: BARequirement;
  headerContent?: React.ReactNode;
  onUpdate: (id: string, changes: Partial<BARequirement>) => void;
  onRequestDelete: (id: string, trigger: HTMLButtonElement) => void;
  onGenerateRequirement: (requirement: BARequirement, customPrompt?: string) => void;
  onGrillRequirement: (requirement: BARequirement) => void;
  onGenerateStory: (requirement: BARequirement, customPrompt?: string) => void;
  onGenerateTestCase: (requirement: BARequirement, customPrompt?: string) => void;
  onGenerateAcceptanceCriteria: (requirement: BARequirement, customPrompt?: string) => void;
  onGenerateBusinessImpact: (requirement: BARequirement, customPrompt?: string) => void;
  onAddTask: (requirementId: string) => void;
  onUpdateTask: (requirementId: string, taskId: string, changes: Partial<BARequirementTask>) => void;
  onRemoveTask: (requirementId: string, taskId: string) => void;
  onSaveTaskToClickUp: (requirement: BARequirement, task: BARequirementTask) => void;
  savingTaskId: string;
  generatingRequirement: boolean;
  onClassifyRequirement: (requirement: BARequirement) => void;
  classifying: boolean;
  generatingStory: boolean;
  generatingTestCase: boolean;
  generatingAcceptanceCriteria: boolean;
  generatingBusinessImpact: boolean;
  classificationError: string;
  classificationPending: boolean;
};

function RequirementCard({ requirement, headerContent, onUpdate, onRequestDelete, onGenerateRequirement, onGrillRequirement, onGenerateStory, onGenerateTestCase, onGenerateAcceptanceCriteria, onGenerateBusinessImpact, onClassifyRequirement, onAddTask, onUpdateTask, onRemoveTask, onSaveTaskToClickUp, savingTaskId, generatingRequirement, generatingStory, generatingTestCase, generatingAcceptanceCriteria, generatingBusinessImpact, classifying, classificationPending, classificationError }: RequirementCardProps) {
  return <article className="min-w-0 border border-line bg-surface-panel p-3 transition-[border-color,background-color,box-shadow] duration-[250ms] ease-out hover:border-warning-border hover:bg-surface-hover sm:p-4">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Business requirement</span>
        <span className="whitespace-nowrap font-mono text-[11px] font-semibold text-fg">{requirement.id}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <select aria-label={`${requirement.id} category`} className={`${cardSelectClass} w-36 shrink-0 ${categoryColor[requirement.category]}`} value={requirement.category} onChange={(event) => onUpdate(requirement.id, { category: event.target.value as RequirementCategory })}>{CATEGORIES.map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label={`${requirement.id} priority`} className={`${cardSelectClass} w-36 shrink-0 ${priorityColor[requirement.priority]}`} value={requirement.priority} onChange={(event) => onUpdate(requirement.id, { priority: event.target.value as MoscowPriority | "" })}><option value="">Unprioritized</option>{PRIORITIES.map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label={`${requirement.id} verification status`} className={`${cardSelectClass} w-32 ${verificationColor[requirement.verification]}`} value={requirement.verification} onChange={(event) => onUpdate(requirement.id, { verification: event.target.value as VerificationStatus })}>{STATUSES.map((value) => <option key={value}>{value}</option>)}</select>
        <button type="button" aria-label={`Delete requirement ${requirement.id}`} title={`Delete ${requirement.id}`} className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-transparent text-fg-muted transition-colors hover:border-danger-border hover:bg-danger-surface hover:text-danger-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus" onClick={(event) => onRequestDelete(requirement.id, event.currentTarget)}><Trash2 aria-hidden="true" size={14} /></button>
      </div>
    </header>
    {headerContent && <section className="mt-2 border-b border-line pb-3">{headerContent}</section>}
    <section className="mt-2 min-w-0 border-l-2 border-l-warning-border bg-surface-panel px-2 py-1"><div className="mb-1 flex min-h-6 items-center justify-between gap-2"><span className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Business requirement</span><div className="inline-flex shrink-0 items-center gap-1"><RequirementGenerationActions label="Business requirement" generating={generatingRequirement} onGenerate={(customPrompt) => onGenerateRequirement(requirement, customPrompt)} onGrill={() => onGrillRequirement(requirement)} grillDisabled={!requirement.statement.trim()} /><RequirementClassificationAction requirementId={requirement.id} generating={classifying} onClassify={() => onClassifyRequirement(requirement)} disabled={classificationPending && !classifying || !requirement.statement.trim()} /></div></div><textarea data-ba-req-id={requirement.id} aria-label={`${requirement.id} business requirement`} rows={1} className="ba-rtm-cell-editor block min-h-8 w-full resize-none overflow-hidden whitespace-pre-wrap break-words [overflow-wrap:anywhere] border border-line bg-surface-panel px-2 py-1 text-base font-semibold leading-6 text-fg focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus" placeholder="Describe the business need" value={requirement.statement} onChange={(event) => onUpdate(requirement.id, { statement: event.target.value })} /></section>
    <div className="mt-2 grid min-w-0 gap-3 lg:grid-cols-3">
      <section className="min-w-0 border-t border-line pt-2">
        <div className="flex min-h-6 items-center justify-between gap-2"><span className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">User story</span><RequirementGenerationActions label="User story" generating={generatingStory} onGenerate={(customPrompt) => onGenerateStory(requirement, customPrompt)} onGrill={() => onGrillRequirement(requirement)} grillDisabled={!requirement.statement.trim()} /></div>
        <RichTextEditor value={requirement.userStory} onChange={(userStory) => onUpdate(requirement.id, { userStory })} label={`${requirement.id} user story`} placeholder="Add a concise user story" />
      </section>
      <section className="min-w-0 border-t border-line pt-2">
        <div className="flex min-h-6 items-center justify-between gap-2"><span className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Test case</span><RequirementGenerationActions label="Test case" generating={generatingTestCase} onGenerate={(customPrompt) => onGenerateTestCase(requirement, customPrompt)} onGrill={() => onGrillRequirement(requirement)} grillDisabled={!requirement.statement.trim()} /></div>
        <RichTextEditor value={requirement.testCase} onChange={(testCase) => onUpdate(requirement.id, { testCase })} label={`${requirement.id} test case`} placeholder="Add a concise test case" />
      </section>
      <section className="min-w-0 border-t border-line pt-2">
        <div className="flex min-h-6 items-center justify-between gap-2"><span className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Acceptance criteria</span><RequirementGenerationActions label="Acceptance criteria" generating={generatingAcceptanceCriteria} onGenerate={(customPrompt) => onGenerateAcceptanceCriteria(requirement, customPrompt)} onGrill={() => onGrillRequirement(requirement)} grillDisabled={!requirement.statement.trim()} /></div>
        <RichTextEditor value={requirement.acceptanceCriteria} onChange={(acceptanceCriteria) => onUpdate(requirement.id, { acceptanceCriteria })} label={`${requirement.id} acceptance criteria`} placeholder="Add concise acceptance criteria" />
      </section>
    </div>
    <section className="mt-3 min-w-0 border-t border-line pt-2"><div className="mb-1 flex min-h-6 items-center justify-between gap-2"><span className={cardSectionLabelClass}>Business impact</span><RequirementGenerationActions label="Business impact" generating={generatingBusinessImpact} onGenerate={(customPrompt) => onGenerateBusinessImpact(requirement, customPrompt)} onGrill={() => onGrillRequirement(requirement)} grillDisabled={!requirement.statement.trim()} /></div><RichTextEditor value={requirement.businessImpact} onChange={(businessImpact) => onUpdate(requirement.id, { businessImpact })} label={`${requirement.id} business impact`} placeholder="Describe the expected value or outcome" />{classificationError && <p role="alert" className="mt-1 text-xs text-danger-fg">{classificationError}</p>}</section>
    <section className="mt-3 w-full" aria-label={`${requirement.id} tasks`}><div className="mb-1 flex items-center justify-between gap-2"><span className={cardSectionLabelClass}>Tasks</span><button type="button" className="inline-flex h-6 items-center gap-1 border border-line px-2 text-[10px] font-semibold text-fg hover:border-link focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus" onClick={() => onAddTask(requirement.id)}><Plus aria-hidden="true" size={12} />Add task</button></div><div className="space-y-1">{requirement.tasks.map((task) => <RequirementTaskRow key={task.id} requirementId={requirement.id} task={task} onUpdate={(changes) => onUpdateTask(requirement.id, task.id, changes)} onRemove={() => onRemoveTask(requirement.id, task.id)} onSaveToClickUp={() => onSaveTaskToClickUp(requirement, task)} savingToClickUp={savingTaskId === task.id} />)}{!requirement.tasks.length && <p className="border border-dashed border-line px-2 py-1.5 text-[11px] text-fg-muted">No tasks added.</p>}</div></section>
    <footer className="mt-3 border-t border-line pt-2 text-[10px] text-fg-secondary">Created {timestampText(requirement.createdAt)} <span aria-hidden="true">·</span> Updated {timestampText(requirement.updatedAt)}</footer>
  </article>;
}
const inputClass = "w-full min-w-0 border border-line bg-surface-panel px-2 py-1.5 text-sm text-fg outline-none focus:border-focus focus:ring-1 focus:ring-focus";
const filterSelectClass = "h-8 min-w-0 border border-line bg-surface-panel px-2 text-xs text-fg outline-none focus:border-focus focus:ring-1 focus:ring-focus";
const buttonClass = "inline-flex min-h-9 items-center justify-center gap-2 border border-link bg-action px-3 py-1.5 text-sm font-semibold text-on-action transition-colors hover:bg-action-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed ";
const secondaryClass = "inline-flex min-h-9 items-center justify-center gap-2 border border-line bg-surface-panel px-3 py-1.5 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed ";

function fileName(value: string) {
  return value.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "business-analysis";
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

async function renderXlsx(project: BAProject) {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("RTM", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Req ID", key: "id", width: 14 }, { header: "Feature Name", key: "featureName", width: 28 }, { header: "Req Description", key: "statement", width: 42 },
    { header: "Technical Feature", key: "technicalFeature", width: 30 }, { header: "Test Case ID", key: "testCaseId", width: 18 },
    { header: "Mapping Status", key: "mappingStatus", width: 18 }, { header: "Implementation Status", key: "implementationStatus", width: 22 },
    { header: "Category", key: "category", width: 20 }, { header: "MoSCoW Priority", key: "priority", width: 18 }, { header: "Complexity", key: "complexity", width: 16 },
    { header: "User Story", key: "userStory", width: 38 }, { header: "Acceptance Criteria", key: "acceptanceCriteria", width: 38 },
    { header: "Test Case Detail", key: "testCase", width: 38 }, { header: "Verification", key: "verification", width: 18 },
    { header: "Business Impact", key: "businessImpact", width: 42 }, { header: "Tasks", key: "tasks", width: 38 },
  ];
  for (const requirement of project.requirements) sheet.addRow({ ...requirement, tasks: requirement.tasks.map((task) => `${task.done ? "[x]" : "[ ]"} ${task.title}`).join("\n") });
  const header = sheet.getRow(1);
  header.height = 24;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF003366" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  const statusFill: Record<VerificationStatus, string> = { Passed: "FFDDF4E4", "In Dev": "FFFFF1C2", "Not Tested": "FFE9EEF3", Blocked: "FFFFE0E0" };
  project.requirements.forEach((requirement, index) => {
    const cell = sheet.getRow(index + 2).getCell(14);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: statusFill[requirement.verification] } };
    sheet.getRow(index + 2).alignment = { vertical: "top", wrapText: true };
  });
  sheet.autoFilter = { from: "A1", to: `P${project.requirements.length + 1}` };

  const addRecordSheet = (name: string, fields: Array<{ header: string; key: string }>, records: Array<Record<string, string>>) => {
    const recordSheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    recordSheet.columns = fields.map((field) => ({ ...field, width: Math.max(18, Math.min(38, field.header.length + 8)) }));
    records.forEach((record) => recordSheet.addRow(record));
    const row = recordSheet.getRow(1);
    row.height = 24;
    row.eachCell((cell) => { cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF003366" } }; cell.alignment = { vertical: "middle", wrapText: true }; });
    recordSheet.eachRow((sheetRow, rowNumber) => { if (rowNumber > 1) sheetRow.alignment = { vertical: "top", wrapText: true }; });
    if (fields.length) recordSheet.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + fields.length)}${records.length + 1}` };
  };
  addRecordSheet("Product Backlog", [{ header: "Feature ID", key: "id" }, { header: "Category", key: "category" }, { header: "Feature Name", key: "featureName" }, { header: "Business Requirement", key: "statement" }, { header: "User Story", key: "userStory" }, { header: "Priority (MoSCoW)", key: "priority" }, { header: "Complexity", key: "complexity" }, { header: "Status", key: "implementationStatus" }], project.requirements.map(({ id, category, featureName, statement, userStory, priority, complexity, implementationStatus }) => ({ id, category, featureName, statement, userStory, priority, complexity, implementationStatus })));
  addRecordSheet("Sprint Backlog", [{ header: "Task ID", key: "id" }, { header: "Task Name", key: "taskName" }, { header: "Module", key: "module" }, { header: "Priority", key: "priority" }, { header: "Status", key: "status" }, { header: "Est. Hours", key: "estimatedHours" }, { header: "Actual Hours", key: "actualHours" }, { header: "Blockers", key: "blockers" }], project.sprintBacklog);
  addRecordSheet("System Design", [{ header: "Component", key: "component" }, { header: "Function", key: "function" }, { header: "Technology / Stack", key: "technology" }, { header: "Data Source", key: "dataSource" }, { header: "Integration Point", key: "integrationPoint" }, { header: "Dependencies", key: "dependencies" }], project.systemDesign);
  addRecordSheet("End to End Process", [{ header: "Step #", key: "id" }, { header: "Process Phase", key: "phase" }, { header: "User Action", key: "userAction" }, { header: "System / Logic", key: "systemLogic" }, { header: "Output / Result", key: "output" }, { header: "Tool Involved", key: "tool" }], project.endToEndProcess);
  addRecordSheet("Deployment", [{ header: "Step #", key: "id" }, { header: "Deployment Phase", key: "phase" }, { header: "Action Item", key: "actionItem" }, { header: "Environment", key: "environment" }, { header: "Owner", key: "owner" }, { header: "Rollback Plan", key: "rollbackPlan" }, { header: "Status", key: "status" }], project.deployments);
  addRecordSheet("Timeline", [{ header: "Phase", key: "phase" }, { header: "Start Date", key: "startDate" }, { header: "End Date", key: "targetDate" }, { header: "Deliverables", key: "deliverables" }], project.phases.map((phase) => ({ phase: phase.name, startDate: phase.startDate, targetDate: phase.targetDate, deliverables: phase.deliverables.map((item) => `${item.done ? "[x]" : "[ ]"} ${item.label}`).join("\n") })));

  const summary = workbook.addWorksheet("Summary");
  summary.columns = [{ header: "Measure", key: "measure", width: 34 }, { header: "Value", key: "value", width: 22 }];
  const linked = project.requirements.filter((item) => item.userStory || item.testCase || item.tasks.length).length;
  summary.addRows([
    { measure: "Project", value: project.name }, { measure: "Requirements", value: project.requirements.length },
    { measure: "Traceability coverage", value: project.requirements.length ? `${Math.round(linked * 100 / project.requirements.length)}%` : "0%" },
    ...STATUSES.map((status) => ({ measure: status, value: project.requirements.filter((item) => item.verification === status).length })),
    { measure: "Unprioritized", value: project.requirements.filter((item) => !item.priority).length },
    { measure: "Sprint backlog tasks", value: project.sprintBacklog.length },
    { measure: "Mapped requirements", value: project.requirements.filter((item) => item.mappingStatus === "Mapped").length },
  ]);
  summary.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF003366" } };
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function meetingNotes(meeting: ArchivedMeeting) {
  const items = meeting.items.map((item, index) => `${index + 1}. ${item.topic || "Discussion"}\n${item.discussion_point || item.evidence || ""}${item.action_plan ? `\nAction: ${item.action_plan}` : ""}`).join("\n\n");
  return [`Meeting: ${meeting.title}`, `Date: ${meeting.date}`, meeting.summary && `Summary:\n${meeting.summary}`, meeting.meeting_notes && `Notes:\n${meeting.meeting_notes}`, items && `Discussion points:\n${items}`].filter(Boolean).join("\n\n");
}

function templateContent(kind: string, project: BAProject) {
  const requirements = project.requirements.map((item) => `${item.id} (${item.priority}, ${item.category})\n${item.statement}${item.businessImpact ? `\nBusiness impact: ${item.businessImpact}` : ""}`).join("\n\n") || "No requirements have been recorded.";
  const phases = project.phases.map((phase) => `${phase.name}: ${phase.startDate || "Start date not set"} to ${phase.targetDate || "Target date not set"}`).join("\n");
  const sprint = project.sprintBacklog.map((item) => `${item.id}: ${item.taskName || "Untitled task"} (${item.status || "Status not set"})${item.blockers ? `\nBlockers: ${item.blockers}` : ""}`).join("\n") || "No sprint tasks have been recorded.";
  const architecture = project.systemDesign.map((item) => `${item.component || "Component"}: ${item.function}\n${item.technology || "Technology not set"}; data: ${item.dataSource || "Not set"}; integration: ${item.integrationPoint || "Not set"}; dependencies: ${item.dependencies || "None listed"}`).join("\n\n") || "No architecture components have been recorded.";
  const process = project.endToEndProcess.map((item) => `${item.id}: ${item.phase || "Process phase"}\nUser: ${item.userAction}\nSystem: ${item.systemLogic}\nOutput: ${item.output}\nTool: ${item.tool}`).join("\n\n") || "No process steps have been recorded.";
  const deployment = project.deployments.map((item) => `${item.id}: ${item.phase || "Deployment phase"}: ${item.actionItem}\nEnvironment: ${item.environment || "Not set"}; owner: ${item.owner || "Not assigned"}; status: ${item.status || "Not set"}\nRollback: ${item.rollbackPlan || "Not recorded"}`).join("\n\n") || "No deployment steps have been recorded.";
  const signoff = kind === "Stakeholder Sign-Off Certificate" ? "\n\nStakeholder sign-off\nName: ______________________________\nRole: _______________________________\nDecision: ___________________________\nSignature: __________________________\nDate: _______________________________" : "";
  return `${kind}\n\nProject: ${project.name}\nPrepared: ${new Date().toLocaleDateString()}\n\nProject context\n${project.description || "Add the project purpose and context."}\n\nProduct backlog\n${requirements}\n\nSprint backlog\n${sprint}\n\nSystem design and architecture\n${architecture}\n\nEnd to end process\n${process}\n\nDeployment\n${deployment}\n\nProject timeline\n${phases}\n\nDecisions and notes\n${project.discoveryNotes || "Add discovery notes and decisions."}${signoff}`;
}

export function BusinessAnalysisView({ userId, meetings: initialMeetings = [], onLoadMeetings }: { userId?: string; meetings?: ArchivedMeeting[]; onLoadMeetings?: () => Promise<ArchivedMeeting[]> }) {
  const { runStructured } = useEchoAI();
  const [state, setState] = useState<BAWorkspaceState>(EMPTY_BA_STATE);
  const [activeId, setActiveId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [loadError, setLoadError] = useState("");
  const [filterCategory, setFilterCategory] = useState("All categories");
  const [filterPriority, setFilterPriority] = useState("All priorities");
  const [requirementsView, setRequirementsView] = useState<"table" | "cards">("cards");
  const [newRequirementFocusId, setNewRequirementFocusId] = useState("");
  const [detailRequirementId, setDetailRequirementId] = useState("");
  const [meetingRows, setMeetingRows] = useState<ArchivedMeeting[]>(initialMeetings);
  const [meetingLoading, setMeetingLoading] = useState(false);
  const [meetingError, setMeetingError] = useState("");
  const [generatingId, setGeneratingId] = useState("");
  const [generatingRequirementId, setGeneratingRequirementId] = useState("");
  const [classifyingRequirementId, setClassifyingRequirementId] = useState("");
  const [generatingTestCaseId, setGeneratingTestCaseId] = useState("");
  const [generatingAcceptanceCriteriaId, setGeneratingAcceptanceCriteriaId] = useState("");
  const [generatingBusinessImpactId, setGeneratingBusinessImpactId] = useState("");
  const [classificationError, setClassificationError] = useState<{ requirementId: string; message: string } | null>(null);
  const [savingTaskId, setSavingTaskId] = useState("");
  const [clickUpSaveTarget, setClickUpSaveTarget] = useState<ClickUpSaveTarget | null>(null);
  const [clickUpLists, setClickUpLists] = useState<ClickUpTaskList[]>([]);
  const [clickUpListsLoading, setClickUpListsLoading] = useState(false);

  const [clickUpListsLoaded, setClickUpListsLoaded] = useState(false);
  const [clickUpListId, setClickUpListId] = useState("");
  const [clickUpSaveError, setClickUpSaveError] = useState("");
  const [grillSession, setGrillSession] = useState<GrillSession | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState(DOC_TEMPLATES[0]);
  const [documentTitle, setDocumentTitle] = useState("");
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [deleteProjectBusy, setDeleteProjectBusy] = useState(false);
  const [deleteProjectError, setDeleteProjectError] = useState("");
  const [deleteRequirementId, setDeleteRequirementId] = useState("");
  const deleteRequirementTriggerRef = useRef<HTMLButtonElement | null>(null);
  const requirementsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const resizeStart = useRef<{ index: number; startX: number; startWidth: number } | null>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const projectMenuButtonRef = useRef<HTMLButtonElement>(null);

  const project = useMemo(() => state.projects.find((item) => item.id === activeId) || null, [state.projects, activeId]);
  const requestRequirementAI = <T,>(instruction: string, requirement: BARequirement, extra: Record<string, unknown> = {}) =>
    runStructured<T>(instruction, JSON.stringify({ project: project ? { name: project.name, description: project.description } : null, requirement, ...extra }));
  const detailRequirement = project?.requirements.find((item) => item.id === detailRequirementId) || null;
  const requirementPendingDelete = project?.requirements.find((item) => item.id === deleteRequirementId) || null;
  const updateProject = useCallback((updater: (current: BAProject) => BAProject) => {
    if (!project) return;
    const updatedAt = new Date().toISOString();
    setState((current) => ({ ...current, projects: current.projects.map((item) => item.id === project.id ? { ...updater(item), updatedAt } : item) }));
    setSaveState("saving");
  }, [project]);

  useEffect(() => {
    let current = true;
    fetch("/api/business-analysis", { cache: "no-store" }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Business Analysis could not load.");
      if (current) {
        const nextState = normalizeBAState(body.state);
        setState(nextState);
        setActiveId("");
        setLoadError("");
      }
    }).catch((error) => { if (current) setLoadError(error instanceof Error ? error.message : "Business Analysis could not load."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [userId]);

  useEffect(() => {
    if (loading || loadError || !state.projects.length) return;
    const timer = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        const response = await fetch("/api/business-analysis", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) });
        if (!response.ok) throw new Error("Save failed");
        setSaveState("saved");
      } catch { setSaveState("error"); }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [state, loading, loadError]);

  const filteredRequirements = useMemo(() => project?.requirements.filter((item) => (filterCategory === "All categories" || item.category === filterCategory) && (filterPriority === "All priorities" || item.priority === filterPriority)) || [], [project, filterCategory, filterPriority]);
  const coverage = filteredRequirements.length ? Math.round(filteredRequirements.filter((item) => item.userStory || item.testCase || item.tasks.length).length * 100 / filteredRequirements.length) : 0;
  const unprioritized = filteredRequirements.filter((item) => !item.priority).length;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document.querySelectorAll<HTMLTextAreaElement>(".ba-rtm-cell-editor").forEach((textarea) => {
        textarea.style.height = "auto";
        textarea.style.height = `${Math.max(textarea.scrollHeight, 28)}px`;
      });
      if (newRequirementFocusId) {
        document.querySelector<HTMLTextAreaElement>(`[data-ba-req-id="${newRequirementFocusId}"]`)?.focus();
        setNewRequirementFocusId("");
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [filteredRequirements, newRequirementFocusId, requirementsView]);

  useEffect(() => {
    if (!detailRequirement) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setDetailRequirementId(""); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailRequirement]);

  useEffect(() => {
    if (!projectMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !projectMenuRef.current?.contains(event.target)) setProjectMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setProjectMenuOpen(false); projectMenuButtonRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [projectMenuOpen]);

  useEffect(() => {
    if (!deleteProjectOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !deleteProjectBusy) setDeleteProjectOpen(false); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [deleteProjectOpen, deleteProjectBusy]);

  useEffect(() => {
    if (!grillSession) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !grillSession.loading) setGrillSession(null); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [grillSession]);

  const saveNow = async () => {
    setSaveState("saving");
    try {
      const response = await fetch("/api/business-analysis", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) });
      if (!response.ok) throw new Error("Save failed");
      setSaveState("saved");
    } catch { setSaveState("error"); }
  };

  const addProject = () => {
    const name = window.prompt("Project name");
    if (!name?.trim()) return;
    const next = createBAProject(name.trim());
    setState((current) => ({ ...current, projects: [...current.projects, next] }));
    setActiveId(next.id);
  };

  const deleteActiveProject = async () => {
    if (!project || deleteProjectBusy) return;
    setDeleteProjectBusy(true);
    setDeleteProjectError("");
    try {
      const response = await fetch("/api/business-analysis", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: project.id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The project could not be deleted. Try again.");
      setState(normalizeBAState(body.state));
      setActiveId("");
      setSaveState("saved");
      setDeleteProjectOpen(false);
    } catch (error) {
      setDeleteProjectError(error instanceof Error ? error.message : "The project could not be deleted. Try again.");
    } finally {
      setDeleteProjectBusy(false);
    }
  };

  const addRequirement = () => {
    if (!project) return;
    const now = new Date().toISOString();
    const requirement: BARequirement = { id: nextRequirementId(project.requirements), createdAt: now, updatedAt: now, statement: "", featureName: "", complexity: "", implementationStatus: "Not Started", technicalFeature: "", testCaseId: "", mappingStatus: "Unmapped", businessImpact: "", category: "Functional", priority: "", userStory: "", acceptanceCriteria: "", testCase: "", verification: "Not Tested", tasks: [] };
    updateProject((current) => ({ ...current, requirements: [...current.requirements, requirement] }));
    setFilterCategory("All categories");
    setFilterPriority("All priorities");
    setNewRequirementFocusId(requirement.id);
  };

  const updateRequirement = (id: string, changes: Partial<BARequirement>) => {
    const updatedAt = new Date().toISOString();
    updateProject((current) => ({ ...current, requirements: current.requirements.map((item) => item.id === id ? { ...item, ...changes, updatedAt } : item) }));
  };

  const deleteRequirement = () => {
    if (!project || !requirementPendingDelete) return;
    updateProject((current) => ({ ...current, requirements: current.requirements.filter((item) => item.id !== requirementPendingDelete.id) }));
    if (detailRequirementId === requirementPendingDelete.id) setDetailRequirementId("");
    setDeleteRequirementId("");
    requestAnimationFrame(() => requirementsHeadingRef.current?.focus());
  };
  const requestDeleteRequirement = (id: string, trigger: HTMLButtonElement) => {
    deleteRequirementTriggerRef.current = trigger;
    setDeleteRequirementId(id);
  };
  const closeDeleteRequirementDialog = () => {
    setDeleteRequirementId("");
    requestAnimationFrame(() => deleteRequirementTriggerRef.current?.focus());
  };

  const addRequirementTask = (requirementId: string) => {
    const requirement = project?.requirements.find((item) => item.id === requirementId);
    if (!requirement) return;
    updateRequirement(requirementId, { tasks: [...requirement.tasks, { id: crypto.randomUUID(), title: "", done: false }] });
  };
  const updateRequirementTask = (requirementId: string, taskId: string, changes: Partial<BARequirementTask>) => {
    const requirement = project?.requirements.find((item) => item.id === requirementId);
    if (!requirement) return;
    updateRequirement(requirementId, { tasks: requirement.tasks.map((task) => task.id === taskId ? { ...task, ...changes } : task) });
  };
  const removeRequirementTask = (requirementId: string, taskId: string) => {
    const requirement = project?.requirements.find((item) => item.id === requirementId);
    if (!requirement) return;
    updateRequirement(requirementId, { tasks: requirement.tasks.filter((task) => task.id !== taskId) });
  };

  const openClickUpTaskSave = async (requirement: BARequirement, task: BARequirementTask) => {
    if (!project) return;
    setClickUpSaveError("");
    setClickUpListId("");
    setClickUpSaveTarget({ projectId: project.id, requirementId: requirement.id, taskId: task.id, taskName: task.title, requirement: requirement.statement });
    if (clickUpListsLoaded) return;
    setClickUpListsLoading(true);
    try {
      const response = await fetch("/api/business-analysis/tasks", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load ClickUp lists.");
      setClickUpLists(Array.isArray(body.lists) ? body.lists : []);
      setClickUpListsLoaded(true);
    } catch (error) { setClickUpSaveError(error instanceof Error ? error.message : "Could not load ClickUp lists."); }
    finally { setClickUpListsLoading(false); }
  };

  const saveRequirementTaskToClickUp = async () => {
    if (!clickUpSaveTarget || !clickUpListId) return;
    const target = clickUpSaveTarget;
    setSavingTaskId(target.taskId);
    setClickUpSaveError("");
    try {
      const response = await fetch("/api/business-analysis/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listId: clickUpListId, taskName: target.taskName, requirementId: target.requirementId, requirement: target.requirement, localTaskId: target.taskId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save this task to ClickUp.");
      const clickUpTask = body.clickUpTask as BARequirementTask["clickUpTask"];
      if (!clickUpTask) throw new Error("ClickUp did not return a task link.");
      const updatedAt = new Date().toISOString();
      setState((current) => ({ ...current, projects: current.projects.map((item) => item.id !== target.projectId ? item : { ...item, updatedAt, requirements: item.requirements.map((requirement) => requirement.id !== target.requirementId ? requirement : { ...requirement, updatedAt, tasks: requirement.tasks.map((task) => task.id === target.taskId ? { ...task, clickUpTask } : task) }) }) }));
      setSaveState("saving");
      setClickUpSaveTarget(null);
    } catch (error) { setClickUpSaveError(error instanceof Error ? error.message : "Could not save this task to ClickUp."); }
    finally { setSavingTaskId(""); }
  };

  const resizeColumn = (index: number, width: number) => setState((current) => ({
    ...current, tableColumnWidths: current.tableColumnWidths.map((value, columnIndex) => columnIndex === index ? Math.max(BA_MIN_COLUMN_WIDTHS[index], Math.min(720, width)) : value),
  }));
  const startColumnResize = (event: React.PointerEvent<HTMLButtonElement>, index: number) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStart.current = { index, startX: event.clientX, startWidth: state.tableColumnWidths[index] || DEFAULT_BA_COLUMN_WIDTHS[index] };
  };
  const moveColumnResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (resizeStart.current) resizeColumn(resizeStart.current.index, resizeStart.current.startWidth + event.clientX - resizeStart.current.startX);
  };
  const stopColumnResize = () => { resizeStart.current = null; };

  const importMinutes = async (meeting: ArchivedMeeting) => {
    const text = meetingNotes(meeting);
    updateProject((current) => {
      const discoveryNotes = [current.discoveryNotes.trim(), text].filter(Boolean).join("\n\n---\n\n");
      return { ...current, discoveryNotes, requirements: requirementsFromNotes(discoveryNotes, current.requirements) };
    });
    setMeetingRows([]);
  };

  const loadMeetings = async () => {
    setMeetingLoading(true);
    setMeetingError("");
    try {
      const result = onLoadMeetings ? await onLoadMeetings() : initialMeetings;
      setMeetingRows(result.filter((meeting) => Boolean(meeting.meeting_notes || meeting.summary || meeting.items?.length)).slice(0, 30));
    } catch (error) { setMeetingError(error instanceof Error ? error.message : "Notetaker records could not be loaded."); }
    finally { setMeetingLoading(false); }
  };

  const generateStory = async (requirement: BARequirement, customPrompt?: string) => {
    if (!project) return;
    setGeneratingId(requirement.id);
    try {
      const body = await requestRequirementAI<{ userStory: string; acceptanceCriteria: string }>(
        `Write one short user story sentence and 2 to 3 concise, testable Given/When/Then acceptance criteria as separate Markdown bullets. Avoid unsupported assumptions. ${customPrompt ? `Additional user guidance: ${customPrompt}` : ""} Return JSON with userStory and acceptanceCriteria strings.`,
        requirement,
      );
      updateRequirement(requirement.id, { userStory: body.userStory, acceptanceCriteria: body.acceptanceCriteria });
    } catch (error) { window.alert(error instanceof Error ? error.message : "Story generation failed."); }
    finally { setGeneratingId(""); }
  };

  const generateRequirement = async (requirement: BARequirement, customPrompt?: string) => {
    if (!project) return;
    setGeneratingRequirementId(requirement.id);
    try {
      const body = await requestRequirementAI<{ statement: string }>(
        `Rewrite the business requirement as one clear, concise sentence. Preserve the stated need and use row details only to clarify. Do not add assumptions, acceptance criteria, or implementation design. ${customPrompt ? `Additional user guidance: ${customPrompt}` : ""} Return JSON with a statement string.`,
        requirement,
      );
      if (typeof body.statement !== "string" || !body.statement.trim()) throw new Error("The generated requirement was empty.");
      updateRequirement(requirement.id, { statement: body.statement.trim() });
    } catch (error) { window.alert(error instanceof Error ? error.message : "Requirement generation failed."); }
    finally { setGeneratingRequirementId(""); }
  };

  const generateBusinessImpact = async (requirement: BARequirement, customPrompt?: string) => {
    if (!project) return;
    setGeneratingBusinessImpactId(requirement.id);
    try {
      const body = await requestRequirementAI<{ businessImpact: string }>(
        `Write one concise sentence describing the expected business value or outcome. Do not invent quantified benefits, urgency, or facts. ${customPrompt ? `Additional user guidance: ${customPrompt}` : ""} Return JSON with a businessImpact string.`,
        requirement,
      );
      if (typeof body.businessImpact !== "string" || !body.businessImpact.trim()) throw new Error("The generated business impact was empty.");
      updateRequirement(requirement.id, { businessImpact: body.businessImpact.trim().slice(0, 3000) });
    } catch (error) { window.alert(error instanceof Error ? error.message : "Business impact generation failed."); }
    finally { setGeneratingBusinessImpactId(""); }
  };

  const classifyRequirement = async (requirement: BARequirement) => {
    if (!project || !requirement.statement.trim()) return;
    setClassificationError(null);
    setClassifyingRequirementId(requirement.id);
    try {
      const body = await requestRequirementAI<{ category: string; priority: string; businessImpact: string }>(
        `Suggest one requirement category from Functional, Non-Functional, Technical, Compliance, Business; one MoSCoW priority from Must Have, Should Have, Could Have, Won't Have; and one short business impact sentence. Ground priority in stated urgency and consequence; use Could Have when evidence is weak. Never invent quantified savings or urgency. Return JSON with category, priority, businessImpact.`,
        requirement,
      );
      const category = CATEGORIES.find((candidate) => candidate === body.category);
      const priority = PRIORITIES.find((candidate) => candidate === body.priority);
      if (!category || !priority || typeof body.businessImpact !== "string" || !body.businessImpact.trim()) {
        throw new Error("The AI response was missing a category, priority, or business impact. Retry, or generate the impact separately.");
      }
      updateRequirement(requirement.id, { category, priority, businessImpact: body.businessImpact.trim().slice(0, 3000) });
    } catch (error) { setClassificationError({ requirementId: requirement.id, message: error instanceof Error ? error.message : "AI suggestions are unavailable right now." }); }
    finally { setClassifyingRequirementId(""); }
  };

  const grillRequest = async (type: "grill-question" | "grill-refine", requirementId: string, statement: string, turns: GrillTurn[]) => {
    if (!project) throw new Error("Open a project before using Grill me.");
    const requirement = project.requirements.find((item) => item.id === requirementId);
    if (!requirement) throw new Error("This requirement is no longer available.");
    const body = await requestRequirementAI<{ question?: string; statement?: string }>(
      type === "grill-question"
        ? "Ask exactly one focused plain-language question that fills the most important missing detail. Do not repeat questions already answered. Return JSON with a question string."
        : "Rewrite the requirement as one clear, concise sentence using only the original requirement, row details, and the user's answers. Preserve intent; add no assumptions or implementation design. Return JSON with a statement string.",
      { ...requirement, statement },
      { turns },
    );
    const output = type === "grill-question" ? body.question : body.statement;
    if (typeof output !== "string" || !output.trim()) throw new Error("Echo returned an empty response. Try again.");
    return output.trim();
  };

  const startRequirementGrill = async (requirement: BARequirement) => {
    const session: GrillSession = { requirementId: requirement.id, statement: requirement.statement, turns: [], question: "", answerDraft: "", refinedStatement: "", loading: true, error: "", errorStage: "" };
    setGrillSession(session);
    try {
      const question = await grillRequest("grill-question", requirement.id, requirement.statement, []);
      setGrillSession((current) => current?.requirementId === requirement.id ? { ...current, question, loading: false, errorStage: "" } : current);
    } catch (error) {
      setGrillSession((current) => current?.requirementId === requirement.id ? { ...current, loading: false, error: error instanceof Error ? error.message : "Grill me is unavailable right now.", errorStage: "question" } : current);
    }
  };

  const askNextGrillQuestion = async () => {
    if (!grillSession || !grillSession.answerDraft.trim() || grillSession.turns.length >= 8) return;
    const { requirementId, statement } = grillSession;
    const turns = [...grillSession.turns, { question: grillSession.question, answer: grillSession.answerDraft.trim() }];
    setGrillSession({ ...grillSession, turns, question: "", answerDraft: "", refinedStatement: "", loading: true, error: "", errorStage: "" });
    try {
      const question = await grillRequest("grill-question", requirementId, statement, turns);
      setGrillSession((current) => current?.requirementId === requirementId ? { ...current, question, loading: false, errorStage: "" } : current);
    } catch (error) {
      setGrillSession((current) => current?.requirementId === requirementId ? { ...current, loading: false, error: error instanceof Error ? error.message : "Grill me is unavailable right now.", errorStage: "question" } : current);
    }
  };

  const refineGrilledRequirement = async () => {
    if (!grillSession) return;
    const { requirementId, statement } = grillSession;
    const turns = grillSession.answerDraft.trim() && grillSession.question
      ? [...grillSession.turns, { question: grillSession.question, answer: grillSession.answerDraft.trim() }]
      : grillSession.turns;
    if (!turns.length) return;
    setGrillSession({ ...grillSession, turns, question: "", answerDraft: "", refinedStatement: "", loading: true, error: "", errorStage: "" });
    try {
      const refinedStatement = await grillRequest("grill-refine", requirementId, statement, turns);
      setGrillSession((current) => current?.requirementId === requirementId ? { ...current, refinedStatement, loading: false, errorStage: "" } : current);
    } catch (error) {
      setGrillSession((current) => current?.requirementId === requirementId ? { ...current, loading: false, error: error instanceof Error ? error.message : "Could not refine this requirement.", errorStage: "refine" } : current);
    }
  };

  const continueRequirementGrill = async () => {
    if (!grillSession) return;
    const { requirementId, statement, turns } = grillSession;
    setGrillSession({ ...grillSession, question: "", answerDraft: "", refinedStatement: "", loading: true, error: "", errorStage: "" });
    try {
      const question = await grillRequest("grill-question", requirementId, statement, turns);
      setGrillSession((current) => current?.requirementId === requirementId ? { ...current, question, loading: false, errorStage: "" } : current);
    } catch (error) {
      setGrillSession((current) => current?.requirementId === requirementId ? { ...current, loading: false, error: error instanceof Error ? error.message : "Grill me is unavailable right now.", errorStage: "question" } : current);
    }
  };

  const applyGrilledRequirement = () => {
    if (!grillSession?.refinedStatement.trim()) return;
    updateRequirement(grillSession.requirementId, { statement: grillSession.refinedStatement.trim() });
    setGrillSession(null);
  };

  const generateTestCase = async (requirement: BARequirement, customPrompt?: string) => {
    setGeneratingTestCaseId(requirement.id);
    try {
      const body = await requestRequirementAI<{ testCase: string }>(
        `Write one short, executable test case with a bold title and concise numbered steps, including expected results. Use only supported requirement details. ${customPrompt ? `Additional user guidance: ${customPrompt}` : ""} Return JSON with a testCase string.`,
        requirement,
      );
      updateRequirement(requirement.id, { testCase: body.testCase });
    } catch (error) { window.alert(error instanceof Error ? error.message : "Test case generation failed."); }
    finally { setGeneratingTestCaseId(""); }
  };

  const generateAcceptanceCriteria = async (requirement: BARequirement, customPrompt?: string) => {
    if (!project) return;
    setGeneratingAcceptanceCriteriaId(requirement.id);
    try {
      const body = await requestRequirementAI<{ acceptanceCriteria: string }>(
        `Write 2 to 3 concise, testable Given/When/Then acceptance criteria as separate Markdown bullets. Use only requirement and row details. ${customPrompt ? `Additional user guidance: ${customPrompt}` : ""} Return JSON with an acceptanceCriteria string.`,
        requirement,
      );
      updateRequirement(requirement.id, { acceptanceCriteria: body.acceptanceCriteria });
    } catch (error) { window.alert(error instanceof Error ? error.message : "Acceptance criteria generation failed."); }
    finally { setGeneratingAcceptanceCriteriaId(""); }
  };

  const addDocument = () => {
    if (!project) return;
    const now = new Date().toISOString();
    const document: BADocument = { id: crypto.randomUUID(), title: documentTitle.trim() || selectedTemplate, kind: selectedTemplate, content: templateContent(selectedTemplate, project), updatedAt: now };
    updateProject((current) => ({ ...current, documents: [...current.documents, document] }));
    setDocumentTitle("");
  };

  const exportDocument = async (item: BADocument) => {
    const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import("docx");
    const doc = new Document({ sections: [{ children: [new Paragraph({ text: item.title, heading: HeadingLevel.TITLE }), ...item.content.split(/\r?\n/).map((line) => new Paragraph({ children: [new TextRun(line || " ")] }))] }] });
    downloadBlob(await Packer.toBlob(doc), `${fileName(item.title)}.docx`);
  };

  if (loading) return <div className="flex min-h-[420px] items-center justify-center bg-surface-panel text-sm text-fg-secondary" role="status"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Loading IT Projects</div>;
  if (loadError) return <div className="mx-auto mt-8 max-w-2xl border border-danger-border bg-surface-panel p-6 text-sm text-danger-fg" role="alert"><h1 className="font-serif text-2xl font-bold italic text-fg">IT Projects</h1><p className="mt-3">{loadError}</p><p className="mt-1">Ask an administrator to install the IT Projects storage table, then reload.</p><button className={`${secondaryClass} mt-4`} onClick={() => window.location.reload()}><RefreshCw size={15} />Reload page</button></div>;

  const reportsContent = (view: "list" | "cards") => project && <section className="space-y-5">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <button className={`${secondaryClass} justify-start p-4`} onClick={async () => downloadBlob(await renderXlsx(project), `${fileName(project.name)}-it-projects.xlsx`)}><Table2 size={18} /><span className="text-left"><strong className="block">Export IT project workbook</strong><span className="mt-1 block text-xs font-normal text-fg">Backlogs, RTM, architecture, process, deployment, and timeline sheets</span></span><Download className="ml-auto" size={15} /></button>
      <button className={`${secondaryClass} justify-start p-4`} onClick={() => window.print()}><Printer size={18} /><span className="text-left"><strong className="block">Print project report</strong><span className="mt-1 block text-xs font-normal text-fg">Open the browser print dialog for a PDF copy</span></span></button>
    </div>
    <section className="space-y-3 border border-line bg-surface-panel p-4"><div><h3 className="font-semibold text-fg">Project documents</h3><p className="mt-1 text-xs text-fg-secondary">Create editable drafts from project information.</p></div>
      <div className="grid gap-2 sm:grid-cols-[220px_minmax(140px,1fr)_auto]"><label className="sr-only" htmlFor="ba-document-template">Document template</label><select id="ba-document-template" className={inputClass} value={selectedTemplate} onChange={(event) => setSelectedTemplate(event.target.value)}><optgroup label="Before delivery">{PRE_DOC_TEMPLATES.map((value) => <option key={value}>{value}</option>)}</optgroup><optgroup label="After delivery">{POST_DOC_TEMPLATES.map((value) => <option key={value}>{value}</option>)}</optgroup></select><label className="sr-only" htmlFor="ba-document-title">New document title</label><input id="ba-document-title" className={inputClass} value={documentTitle} onChange={(event) => setDocumentTitle(event.target.value)} placeholder="Optional title" /><button className={buttonClass} onClick={addDocument}><FilePlus2 size={15} />Create draft</button></div>
      {project.documents.length === 0 ? <p className="border border-dashed border-line p-4 text-sm text-fg-secondary">No project documents yet.</p> : view === "list" ? <div className="overflow-x-auto border border-line"><table className="w-full min-w-[760px] border-collapse text-left text-xs"><thead className="bg-surface-raised text-[10px] uppercase text-fg-secondary"><tr>{["Title", "Type", "Last updated", "Draft", ""].map((label, index) => <th key={index} className="border border-line px-3 py-2">{label}</th>)}</tr></thead><tbody>{project.documents.map((item, index) => <tr key={item.id} className={index % 2 ? "bg-surface-raised" : "bg-surface-panel"}><td className="w-48 border border-line p-2"><label className="sr-only" htmlFor={`doc-title-${item.id}`}>Document title</label><input id={`doc-title-${item.id}`} className={`${inputClass} font-semibold`} value={item.title} onChange={(event) => updateProject((current) => ({ ...current, documents: current.documents.map((doc) => doc.id === item.id ? { ...doc, title: event.target.value, updatedAt: new Date().toISOString() } : doc) }))} /></td><td className="border border-line px-3 py-2">{item.kind}</td><td className="border border-line px-3 py-2">{item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : ""}</td><td className="min-w-[320px] border border-line p-2"><label className="sr-only" htmlFor={`doc-content-${item.id}`}>Document content</label><textarea id={`doc-content-${item.id}`} className={`${inputClass} min-h-20 resize-y leading-5`} value={item.content} onChange={(event) => updateProject((current) => ({ ...current, documents: current.documents.map((doc) => doc.id === item.id ? { ...doc, content: event.target.value, updatedAt: new Date().toISOString() } : doc) }))} /></td><td className="border border-line px-2 py-2"><button className={secondaryClass} onClick={() => void exportDocument(item)}><Download size={15} />Word</button></td></tr>)}</tbody></table></div> : <div className="space-y-3">{project.documents.map((item) => <article key={item.id} className="border border-line p-3"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div className="flex min-w-0 flex-1 gap-3"><label className="sr-only" htmlFor={`doc-title-${item.id}`}>Document title</label><input id={`doc-title-${item.id}`} className={`${inputClass} max-w-xl font-semibold`} value={item.title} onChange={(event) => updateProject((current) => ({ ...current, documents: current.documents.map((doc) => doc.id === item.id ? { ...doc, title: event.target.value, updatedAt: new Date().toISOString() } : doc) }))} /><span className="self-center text-xs text-fg-muted">{item.kind} · {item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : ""}</span></div><button className={secondaryClass} onClick={() => void exportDocument(item)}><Download size={15} />Download Word</button></div><label className="sr-only" htmlFor={`doc-content-${item.id}`}>Document content</label><textarea id={`doc-content-${item.id}`} className={`${inputClass} min-h-40 resize-y leading-6`} value={item.content} onChange={(event) => updateProject((current) => ({ ...current, documents: current.documents.map((doc) => doc.id === item.id ? { ...doc, content: event.target.value, updatedAt: new Date().toISOString() } : doc) }))} /></article>)}</div>}
    </section>
  </section>;

  return <div id="ba-print-root" className="mx-auto w-full max-w-[1440px] space-y-5 pb-8 text-fg">
    <style>{`@media print { body * { visibility: hidden !important; } #ba-print-root, #ba-print-root * { visibility: visible !important; } #ba-print-root { position: absolute; left: 0; top: 0; width: 100%; } .ba-no-print { display: none !important; } input, textarea, select { border: 0 !important; } }`}</style>
    <header className="flex min-h-[58px] flex-col justify-between gap-2 border-b border-link pb-2 sm:flex-row sm:items-center">
      <div className="flex min-w-0 items-center gap-2">
        {project ? <button type="button" onClick={() => setActiveId("")} aria-label="Back to IT Projects" className="ba-no-print inline-flex h-9 w-9 shrink-0 items-center justify-center border border-line text-fg hover:border-link focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"><ArrowLeft aria-hidden="true" className="h-4 w-4" /></button> : <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center border border-warning-border bg-warning-surface text-fg"><FolderKanban className="h-4 w-4" /></span>}
        <div className="min-w-0 border-l-2 border-warning-border py-0.5 pl-2.5">
          <p className="text-[8px] font-bold uppercase tracking-[0.16em] text-fg-secondary">{project ? "IT Projects workspace" : "IT Projects"}</p>
          <h1 className="truncate text-xl font-semibold tracking-tight text-fg">{project?.name || "IT Projects"}</h1>
          {!project && <p className="mt-0.5 truncate text-xs text-fg-secondary">Choose a project to view its timeline, backlogs, and delivery records.</p>}
        </div>
      </div>
      <div className="ba-no-print flex flex-wrap items-center gap-2">
        {!project && <button className={`${secondaryClass} min-h-8 bg-surface-panel px-2.5 py-1 text-[11px]`} onClick={addProject}><Plus size={14} />New project</button>}
        {project && <div ref={projectMenuRef} className="relative"><button ref={projectMenuButtonRef} type="button" aria-label="Project options" title="Project options" aria-haspopup="menu" aria-expanded={projectMenuOpen} className="inline-flex h-8 w-8 items-center justify-center border border-line bg-surface-panel text-fg hover:border-link focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus" onClick={() => setProjectMenuOpen((open) => !open)}><MoreHorizontal aria-hidden="true" size={16} /></button>{projectMenuOpen && <div role="menu" aria-label={`${project.name} options`} className="absolute right-0 top-full z-30 mt-1 min-w-40 border border-line bg-surface-panel p-1 shadow-md"><button type="button" role="menuitem" className="flex min-h-8 w-full items-center gap-2 px-2 text-left text-xs text-danger-fg hover:bg-danger-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus" onClick={() => { setProjectMenuOpen(false); setDeleteProjectError(""); setDeleteProjectOpen(true); }}><Trash2 aria-hidden="true" size={13} />Delete project</button></div>}</div>}
        {saveState !== "saved" && <span className="mr-1 text-xs text-fg" role="status">{saveState === "saving" ? "Saving" : "Save failed"}</span>}
        <button className={`${secondaryClass} min-h-8 bg-surface-panel px-2.5 py-1 text-[11px]`} onClick={saveNow}><Save size={14} />Save</button>
      </div>
    </header>

    {!project ? state.projects.length === 0 ? <section className="border border-dashed border-line bg-surface-panel px-5 py-12 text-center"><FolderKanban aria-hidden="true" className="mx-auto h-6 w-6 text-fg-secondary" /><h2 className="mt-3 text-base font-semibold text-fg">Create your first IT project</h2><p className="mx-auto mt-1 max-w-md text-sm text-fg-secondary">Track its timeline, backlogs, architecture, process, and release plan in one workspace.</p></section> : <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {state.projects.map((item) => <button key={item.id} type="button" onClick={() => setActiveId(item.id)} className="group min-h-40 border border-line bg-surface-panel p-4 text-left transition-colors hover:border-warning-border hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"><span className="flex h-full flex-col"><span className="flex items-start justify-between gap-3"><span className="flex h-9 w-9 items-center justify-center border border-warning-border bg-warning-surface text-fg"><FolderKanban aria-hidden="true" className="h-4 w-4" /></span><ArrowUpRight aria-hidden="true" className="h-4 w-4 text-fg-muted transition-colors group-hover:text-fg" /></span><span className="mt-4 text-base font-semibold text-fg">{item.name}</span><span className="mt-1 text-xs text-fg-muted">{item.requirements.length} feature{item.requirements.length === 1 ? "" : "s"} · {item.sprintBacklog.length} sprint tasks · {item.documents.length} report{item.documents.length === 1 ? "" : "s"}</span><span className="mt-auto pt-4 text-[10px] font-semibold uppercase tracking-wide text-fg-secondary">Open project</span></span></button>)}
    </section> : <>
      <ITProjectSections project={project} updateProject={updateProject} updateRequirement={updateRequirement} addRequirement={addRequirement} onRequestDeleteRequirement={requestDeleteRequirement} onViewRequirement={setDetailRequirementId} reports={reportsContent} tableColumnWidths={state.tableColumnWidths} resizeColumn={resizeColumn} filterCategory={filterCategory} filterPriority={filterPriority} onFilterCategoryChange={setFilterCategory} onFilterPriorityChange={setFilterPriority} renderRequirementCard={(requirement, headerContent) => <RequirementCard
        requirement={requirement} headerContent={headerContent} onUpdate={updateRequirement} onRequestDelete={requestDeleteRequirement}
        onGenerateRequirement={generateRequirement} onGrillRequirement={startRequirementGrill} onGenerateStory={generateStory}
        onGenerateTestCase={generateTestCase} onGenerateAcceptanceCriteria={generateAcceptanceCriteria} onGenerateBusinessImpact={generateBusinessImpact}
        onClassifyRequirement={classifyRequirement} onAddTask={addRequirementTask} onUpdateTask={updateRequirementTask}
        onRemoveTask={removeRequirementTask} onSaveTaskToClickUp={openClickUpTaskSave} savingTaskId={savingTaskId}
        generatingRequirement={generatingRequirementId === requirement.id} generatingStory={generatingId === requirement.id}
        generatingTestCase={generatingTestCaseId === requirement.id} generatingAcceptanceCriteria={generatingAcceptanceCriteriaId === requirement.id}
        generatingBusinessImpact={generatingBusinessImpactId === requirement.id} classifying={classifyingRequirementId === requirement.id}
        classificationPending={Boolean(classificationError)} classificationError={classificationError?.requirementId === requirement.id ? classificationError.message : ""}
      />} />
    </>}
    {deleteRequirementId && requirementPendingDelete && <div className="ba-no-print fixed inset-0 z-[85] flex items-center justify-center bg-scrim p-3 sm:p-6" onClick={closeDeleteRequirementDialog}><section role="alertdialog" aria-modal="true" aria-labelledby="ba-delete-requirement-title" aria-describedby="ba-delete-requirement-description" className="w-full max-w-md border border-line bg-surface-panel shadow-xl" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeDeleteRequirementDialog(); } if (event.key === "Tab") { const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])")); const first = buttons[0]; const last = buttons[buttons.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }}><header className="border-b border-line px-4 py-3"><h2 id="ba-delete-requirement-title" className="font-serif text-lg font-bold italic text-fg">Delete requirement?</h2><p id="ba-delete-requirement-description" className="mt-1 text-xs leading-5 text-fg-secondary"><strong>{requirementPendingDelete.id}</strong> and its local tasks will be removed from this project. Linked tasks already saved to ClickUp will remain there.</p></header><div className="flex justify-end gap-2 p-4"><button type="button" autoFocus className={secondaryClass} onClick={closeDeleteRequirementDialog}>Cancel</button><button type="button" className="inline-flex min-h-9 items-center justify-center gap-2 border border-danger-border bg-danger-surface px-3 py-1.5 text-xs font-semibold text-on-action transition-colors hover:bg-danger-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" onClick={deleteRequirement}><Trash2 aria-hidden="true" size={14} />Delete requirement</button></div></section></div>}

    {deleteProjectOpen && project && <div className="ba-no-print fixed inset-0 z-[80] flex items-center justify-center bg-scrim p-3 sm:p-6" onClick={() => { if (!deleteProjectBusy) setDeleteProjectOpen(false); }}><section role="alertdialog" aria-modal="true" aria-labelledby="ba-delete-project-title" aria-describedby="ba-delete-project-description" className="w-full max-w-md border border-line bg-surface-panel shadow-xl" onClick={(event) => event.stopPropagation()}><header className="border-b border-line px-4 py-3"><h2 id="ba-delete-project-title" className="font-serif text-lg font-bold italic text-fg">Delete project?</h2><p id="ba-delete-project-description" className="mt-1 text-xs leading-5 text-fg-secondary">“{project.name}” and its backlogs, timeline, architecture, process, deployment plan, and reports will be removed from this workspace. Tasks already saved to an external task list will remain there.</p></header><div className="space-y-3 p-4">{deleteProjectError && <p role="alert" className="text-xs text-danger-fg">{deleteProjectError}</p>}<div className="flex justify-end gap-2"><button type="button" autoFocus className={secondaryClass} disabled={deleteProjectBusy} onClick={() => setDeleteProjectOpen(false)}>Cancel</button><button type="button" className="inline-flex min-h-9 items-center justify-center gap-2 border border-danger-border bg-danger-surface px-3 py-1.5 text-xs font-semibold text-on-action hover:bg-danger-surface disabled:cursor-wait  focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" disabled={deleteProjectBusy} onClick={() => void deleteActiveProject()}>{deleteProjectBusy ? <LoaderCircle aria-hidden="true" size={14} className="animate-spin" /> : <Trash2 aria-hidden="true" size={14} />}{deleteProjectBusy ? "Deleting…" : "Delete project"}</button></div></div></section></div>}

    {detailRequirement && <div className="ba-no-print fixed inset-0 z-50 flex items-center justify-center bg-scrim p-3 sm:p-6" onClick={() => setDetailRequirementId("")}><section role="dialog" aria-modal="true" aria-labelledby="ba-requirement-detail-title" className="max-h-[min(760px,calc(100dvh-1.5rem))] w-full max-w-3xl overflow-y-auto border border-line bg-surface-panel shadow-xl" onClick={(event) => event.stopPropagation()}>
      <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3 sm:px-5"><div><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-fg-secondary">{project?.name || "IT Projects"}</p><h2 id="ba-requirement-detail-title" className="mt-1 font-serif text-xl font-bold italic text-fg">{detailRequirement.id}</h2></div><button type="button" aria-label="Close requirement details" className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-line text-fg hover:border-link focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus" onClick={() => setDetailRequirementId("")}><X aria-hidden="true" size={15} /></button></header>
      <dl className="grid grid-cols-1 gap-px bg-surface-raised sm:grid-cols-2">
        <div className="bg-surface-panel p-3 sm:col-span-2"><dt className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Business requirement</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">{detailRequirement.statement || "—"}</dd></div>
        <div className="bg-surface-panel p-3 sm:col-span-2"><dt className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Business impact</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">{detailRequirement.businessImpact || "—"}</dd></div>
        <div className="bg-surface-panel p-3"><dt className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Category</dt><dd className="mt-1 text-sm font-medium text-fg">{detailRequirement.category}</dd></div>
        <div className="bg-surface-panel p-3"><dt className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">MoSCoW priority</dt><dd className="mt-1 text-sm font-medium text-fg">{detailRequirement.priority || "Unprioritized"}</dd></div>
        <div className="bg-surface-panel p-3"><dt className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Verification</dt><dd className="mt-1 text-sm font-medium text-fg">{detailRequirement.verification}</dd></div>
        <div className="bg-surface-panel p-3 sm:col-span-2"><dt className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Tasks</dt><dd className="mt-1 space-y-1 text-sm text-fg">{detailRequirement.tasks.length ? detailRequirement.tasks.map((task) => <div key={task.id} className="flex items-start gap-2"><span className="text-fg-secondary">{task.done ? "✓" : "○"}</span><span className={task.done ? "text-fg-muted line-through" : ""}>{task.title || "Untitled task"}{task.clickUpTask && <a className="ml-2 inline-flex items-center gap-1 text-xs text-fg-secondary hover:text-fg" href={task.clickUpTask.url || `https://app.clickup.com/t/${encodeURIComponent(task.clickUpTask.id)}`} target="_blank" rel="noreferrer">Open linked task <ArrowUpRight size={12} /></a>}</span></div>) : "—"}</dd></div>
        <div className="bg-surface-panel p-3"><dt className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">User story</dt><dd className="mt-1 text-sm text-fg">{detailRequirement.userStory ? <RichTextPreview value={detailRequirement.userStory} /> : "—"}</dd></div>
        <div className="bg-surface-panel p-3"><dt className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Test case</dt><dd className="mt-1 text-sm text-fg">{detailRequirement.testCase ? <RichTextPreview value={detailRequirement.testCase} /> : "—"}</dd></div>
        <div className="bg-surface-panel p-3 sm:col-span-2"><dt className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Acceptance criteria</dt><dd className="mt-1 text-sm text-fg">{detailRequirement.acceptanceCriteria ? <RichTextPreview value={detailRequirement.acceptanceCriteria} /> : "—"}</dd></div>
        <div className="bg-surface-panel p-3"><dt className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Created</dt><dd className="mt-1 text-xs text-fg">{timestampText(detailRequirement.createdAt)}</dd></div>
        <div className="bg-surface-panel p-3"><dt className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Last updated</dt><dd className="mt-1 text-xs text-fg">{timestampText(detailRequirement.updatedAt)}</dd></div>
      </dl>
    </section></div>}
    {clickUpSaveTarget && <div className="ba-no-print fixed inset-0 z-[60] flex items-center justify-center bg-scrim p-3" onClick={() => setClickUpSaveTarget(null)}><section role="dialog" aria-modal="true" aria-labelledby="ba-clickup-save-title" className="w-full max-w-md border border-line bg-surface-panel shadow-xl" onClick={(event) => event.stopPropagation()}>
      <header className="flex items-center justify-between border-b border-line px-4 py-3"><div><h2 id="ba-clickup-save-title" className="font-serif text-lg font-bold italic text-fg">Save task to ClickUp</h2><p className="mt-0.5 text-xs text-fg-secondary">The task will stay in this requirement too.</p></div><button type="button" aria-label="Close ClickUp save dialog" className="inline-flex h-7 w-7 items-center justify-center border border-line text-fg" onClick={() => setClickUpSaveTarget(null)}><X size={14} /></button></header>
      <div className="space-y-3 p-4"><div className="border border-line bg-surface-panel px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">{clickUpSaveTarget.requirementId}</p><p className="mt-1 text-sm font-medium text-fg">{clickUpSaveTarget.taskName}</p></div>
        {clickUpListsLoading ? <p className="text-sm text-fg-secondary">Loading available lists…</p> : clickUpLists.length ? <label className="block text-xs font-semibold text-fg">Task list<select className={`${inputClass} mt-1`} value={clickUpListId} onChange={(event) => setClickUpListId(event.target.value)}><option value="">Choose a list</option>{clickUpLists.map((list) => <option key={list.id} value={list.id}>{[list.teamName, list.spaceName, list.folderName, list.name].filter(Boolean).join(" / ")}</option>)}</select></label> : <p className="text-sm text-fg-secondary">No task lists are available for your connected account.</p>}
        {clickUpSaveError && <p role="alert" className="text-sm text-danger-fg">{clickUpSaveError}</p>}
        <div className="flex justify-end gap-2"><button type="button" className={secondaryClass} onClick={() => setClickUpSaveTarget(null)}>Cancel</button><button type="button" className={buttonClass} disabled={!clickUpListId || clickUpListsLoading || Boolean(savingTaskId)} onClick={() => void saveRequirementTaskToClickUp()}>{savingTaskId ? <LoaderCircle size={14} className="animate-spin" /> : <ArrowUpRight size={14} />}Save linked copy</button></div>
      </div>
    </section></div>}
    {grillSession && <div className="ba-no-print fixed inset-0 z-[70] flex items-center justify-center bg-scrim p-3 sm:p-6" onClick={() => { if (!grillSession.loading) setGrillSession(null); }}><section role="dialog" aria-modal="true" aria-labelledby="ba-grill-title" className="max-h-[min(760px,calc(100dvh-1.5rem))] w-full max-w-xl overflow-y-auto border border-line bg-surface-panel shadow-xl" onClick={(event) => event.stopPropagation()}>
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3"><div><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-fg-secondary">{project?.name || "Business Analysis"} · {grillSession.requirementId}</p><h2 id="ba-grill-title" className="mt-1 font-serif text-xl font-bold italic text-fg">Grill me</h2><p className="mt-0.5 text-xs text-fg-secondary">Answer a few focused questions, then review the refined requirement.</p></div><button type="button" aria-label="Close Grill me" disabled={grillSession.loading} className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-line text-fg " onClick={() => setGrillSession(null)}><X aria-hidden="true" size={14} /></button></header>
      <div className="space-y-3 p-4"><div className="border-l-2 border-l-warning-border bg-surface-panel px-3 py-2"><p className="text-[9px] font-semibold uppercase tracking-wide text-fg-muted">Current requirement</p><p className="mt-1 text-sm font-medium leading-5 text-fg">{grillSession.statement}</p></div>
        {grillSession.turns.length > 0 && <div className="max-h-52 space-y-2 overflow-y-auto">{grillSession.turns.map((turn, index) => <div key={`${index}-${turn.question}`} className="border border-line bg-surface-panel px-3 py-2 text-xs"><p className="font-semibold text-fg">Q{index + 1}. {turn.question}</p><p className="mt-1 whitespace-pre-wrap text-fg">{turn.answer}</p></div>)}</div>}
        {grillSession.loading && <p role="status" className="flex items-center gap-2 text-sm text-fg-secondary"><LoaderCircle size={14} className="animate-spin text-fg-secondary" />Thinking of the next question…</p>}
        {grillSession.error && <p role="alert" className="text-sm text-danger-fg">{grillSession.error}</p>}
        {grillSession.refinedStatement ? <label className="block text-xs font-semibold text-fg">Refined requirement<textarea rows={3} value={grillSession.refinedStatement} onChange={(event) => setGrillSession((current) => current ? { ...current, refinedStatement: event.target.value } : current)} className={`${inputClass} mt-1 resize-y leading-5`} /></label> : grillSession.question ? <div className="space-y-1.5"><p className="text-sm font-semibold leading-5 text-fg">{grillSession.question}</p><label htmlFor="ba-grill-answer" className="sr-only">Your answer</label><textarea id="ba-grill-answer" rows={3} autoFocus value={grillSession.answerDraft} onChange={(event) => setGrillSession((current) => current ? { ...current, answerDraft: event.target.value } : current)} placeholder="Add a short answer" className={`${inputClass} resize-y leading-5`} /></div> : null}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3"><p className="text-[10px] text-fg-muted">{grillSession.turns.length} {grillSession.turns.length === 1 ? "answer" : "answers"}{grillSession.turns.length >= 8 ? " · question limit reached" : ""}</p><div className="flex flex-wrap justify-end gap-2"><button type="button" className={secondaryClass} disabled={grillSession.loading} onClick={() => setGrillSession(null)}>Cancel</button>
          {grillSession.refinedStatement ? <><button type="button" className={secondaryClass} disabled={grillSession.loading || grillSession.turns.length >= 8} onClick={() => void continueRequirementGrill()}>Ask another</button><button type="button" className={buttonClass} disabled={grillSession.loading || !grillSession.refinedStatement.trim()} onClick={applyGrilledRequirement}><Check size={14} />Use requirement</button></> : <><button type="button" className={secondaryClass} disabled={grillSession.loading || !(grillSession.turns.length || grillSession.answerDraft.trim())} onClick={() => void refineGrilledRequirement()}>Finish and refine</button><button type="button" className={buttonClass} disabled={grillSession.loading || !grillSession.answerDraft.trim() || grillSession.turns.length >= 8} onClick={() => void askNextGrillQuestion()}>Next question <ArrowUpRight size={13} /></button></>}
          {grillSession.error && !grillSession.question && !grillSession.refinedStatement && <button type="button" className={buttonClass} disabled={grillSession.loading} onClick={() => void (grillSession.errorStage === "refine" ? refineGrilledRequirement() : continueRequirementGrill())}>{grillSession.errorStage === "refine" ? "Retry refinement" : "Retry question"}</button>}
        </div></div>
      </div>
    </section></div>}
    <footer className="ba-no-print mt-8 flex items-center gap-2 border-t border-line pt-3 text-xs text-fg-secondary"><Check size={14} className={saveState === "error" ? "text-danger-fg" : "text-fg"} aria-hidden="true" />{saveState === "error" ? "Changes are not saved. Use Save to retry." : "Changes save to your IT Projects workspace."}</footer>
  </div>;
}
