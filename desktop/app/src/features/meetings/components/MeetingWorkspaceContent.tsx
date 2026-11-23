import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Bold, List } from "lucide-react";
import { SearchableMemberMultiSelect, type ClickUpMember } from "@/components/SearchableMemberSelect";
import { useEchoAI } from "@/features/ask-echo/components/EchoAI";

const desktopMode = process.env.NEXT_PUBLIC_MOSAIC_DESKTOP === "1";

export function useMeetingAssignees(enabled: boolean) {
  const [members, setMembers] = useState<ClickUpMember[]>([]);
  useEffect(() => {
    if (!enabled || desktopMode) return;
    let cancelled = false;
    fetch("/api/meeting-assignees", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Unable to load ClickUp members")))
      .then((data) => { if (!cancelled) setMembers(data.members || []); })
      .catch(() => { if (!cancelled) setMembers([]); });
    return () => { cancelled = true; };
  }, [enabled]);
  return members;
}

export interface MeetingActionItemRow {
  id: string;
  discussionPointId: string;
  discussionPointTitle: string;
  discussionPoint: string;
  actionPlan: string;
  targetDate: string;
  personInCharge: string;
  assigneeId?: string;
  assigneeIds?: string[];
}

type ActionItemField = "actionPlan" | "targetDate" | "personInCharge";

interface MeetingActionItemsTableProps {
  items: MeetingActionItemRow[];
  members?: ClickUpMember[];
  onChange?: (itemId: string, field: ActionItemField, value: string, assigneeIds?: string[]) => void;
  renderAction?: (item: MeetingActionItemRow) => ReactNode;
}

interface MeetingDiscussionCardProps {
  title: string;
  discussionPoint: string;
  evidenceQuote?: string;
  category?: string;
  importance?: string;
  whyItMatters?: string;
  actionCount?: number;
  onTitleChange?: (value: string) => void;
  onDiscussionPointChange?: (value: string) => void;
  onAddAction?: () => void;
  children?: ReactNode;
}

const actionFields: { label: string; field: ActionItemField }[] = [
  { label: "Action Plan", field: "actionPlan" },
  { label: "Target Date", field: "targetDate" },
  { label: "Person in Charge", field: "personInCharge" },
];

function AutoResizeTextarea({
  label,
  id,
  value,
  onChange,
  placeholder,
  className = "",
  rows = 2,
}: {
  label: string;
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(44, textarea.scrollHeight)}px`;
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      id={id}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={rows}
      className={`w-full resize-none overflow-hidden border border-line bg-surface-panel p-2.5 text-sm leading-relaxed text-fg focus:border-focus focus:outline-none ${className}`}
    />
  );
}

function renderDiscussionPoint(value: string) {
  const blocks: { type: "paragraph" | "list"; lines: string[] }[] = [];

  value.replace(/\\+\*/g, "*").split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim().replace(/^\\([-*•])\s+/, "$1 ");
    if (!line) return;
    const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      const last = blocks.at(-1);
      if (last?.type === "list") last.lines.push(bullet[1]);
      else blocks.push({ type: "list", lines: [bullet[1]] });
      return;
    }

    const last = blocks.at(-1);
    if (last?.type === "paragraph") last.lines[last.lines.length - 1] += ` ${line}`;
    else blocks.push({ type: "paragraph", lines: [line] });
  });

  const renderEmphasis = (text: string, keyPrefix: string) => text.split(/(\*\*[^*]+\*\*)/g).map((part, partIndex) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={`${keyPrefix}-${partIndex}`} className="font-bold text-fg">{part.slice(2, -2)}</strong>
      : <Fragment key={`${keyPrefix}-${partIndex}`}>{part}</Fragment>
  );

  return blocks.map((block, index) => block.type === "list" ? (
    <ul key={`list-${index}`} className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-fg">
      {block.lines.map((line, lineIndex) => <li key={lineIndex}>{renderEmphasis(line, `list-${index}-${lineIndex}`)}</li>)}
    </ul>
  ) : (
    <p key={`paragraph-${index}`} className="text-sm leading-relaxed text-fg">
      {renderEmphasis(block.lines.join(" "), `paragraph-${index}`)}
    </p>
  ));
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

function inlineMarkup(value: string) {
  return escapeHtml(value.replace(/\\+\*/g, "*")).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function discussionHtml(value: string) {
  const lines = value.replace(/\\+\*/g, "*").split(/\r?\n/);
  const parts: string[] = [];
  let bullets: string[] = [];
  const flushBullets = () => {
    if (bullets.length) parts.push(`<ul>${bullets.map((line) => `<li>${inlineMarkup(line)}</li>`).join("")}</ul>`);
    bullets = [];
  };
  for (const rawLine of lines) {
    const line = rawLine.trim().replace(/^\\([-*•])\s+/, "$1 ");
    if (!line) { flushBullets(); continue; }
    const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) bullets.push(bullet[1]);
    else { flushBullets(); parts.push(`<p>${inlineMarkup(line)}</p>`); }
  }
  flushBullets();
  return parts.join("") || "<p><br></p>";
}

function discussionMarkdown(root: HTMLElement) {
  return Array.from(root.children).map((block) => {
    if (block.tagName === "UL" || block.tagName === "OL") {
      return Array.from(block.children).map((item) => `- ${Array.from(item.childNodes).map(markdownNode).join("").trim()}`).join("\n");
    }
    return Array.from(block.childNodes).map(markdownNode).join("").trim();
  }).filter(Boolean).join("\n");
}

function markdownNode(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (node instanceof HTMLElement && node.tagName === "BR") return "\n";
  const content = Array.from(node.childNodes).map(markdownNode).join("");
  return node instanceof HTMLElement && ["STRONG", "B"].includes(node.tagName) ? `**${content}**` : content;
}

export function MeetingDiscussionCard({
  title,
  discussionPoint,
  evidenceQuote = "",
  category,
  importance,
  whyItMatters = "",
  actionCount = 0,
  onTitleChange,
  onDiscussionPointChange,
  onAddAction,
  children,
}: MeetingDiscussionCardProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const current = discussionMarkdown(editor).replace(/\\+\*/g, "*").trim();
    const expected = discussionPoint.replace(/\\+\*/g, "*").trim();
    if (current !== expected) editor.innerHTML = discussionHtml(discussionPoint);
  }, [discussionPoint]);

  const applyEditorCommand = (command: "bold" | "insertUnorderedList") => {
    editorRef.current?.focus();
    document.execCommand(command);
    if (editorRef.current) onDiscussionPointChange?.(discussionMarkdown(editorRef.current));
  };

  return (
    <article className="space-y-3 border border-line bg-surface-panel p-5 shadow-2xs">
      {onTitleChange ? (
        <input
          aria-label="Discussion topic"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="Topic title"
          className="w-full border-b border-line bg-transparent py-1 font-serif text-base font-bold italic text-fg focus:border-focus focus:outline-none"
        />
      ) : (
        <h3 className="font-serif text-base font-bold italic text-fg">{title || "Discussion"}</h3>
      )}

      {evidenceQuote.trim() && (
        <section aria-label="Evidence quote / context reference" className="border-l-2 border-warning-border bg-surface-panel px-3 py-2">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-fg-muted">Evidence quote / context reference</p>
          <p className="font-serif text-sm italic leading-relaxed text-fg-secondary">{evidenceQuote}</p>
        </section>
      )}

      {(category || importance) && (
        <div aria-label="Discussion classification" className="flex flex-wrap gap-1.5">
          {category && <span className="border border-link bg-info-surface px-2 py-0.5 text-[10px] font-semibold capitalize tracking-wide text-fg">{category.replace(/_/g, " ")}</span>}
          {importance && <span className="border border-warning-border bg-warning-surface px-2 py-0.5 text-[10px] font-semibold capitalize tracking-wide text-warning-fg">{importance}</span>}
        </div>
      )}

      {category === "insight" && whyItMatters.trim() && (
        <section aria-label="Why it matters" className="border-l-2 border-link bg-info-surface px-3 py-2">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-fg-muted">Why it matters</p>
          <p className="text-sm leading-relaxed text-fg">{whyItMatters}</p>
        </section>
      )}

      {onDiscussionPointChange ? (
        <div className="border border-line bg-surface-panel focus-within:border-focus">
          <div className="flex items-center gap-1 border-b border-line px-2 py-1.5" aria-label="Discussion formatting">
            <button type="button" aria-label="Bold selected text" title="Bold selected text" onMouseDown={(event) => event.preventDefault()} onClick={() => applyEditorCommand("bold")} className="inline-flex items-center gap-1 border border-transparent px-2 py-1 text-[11px] font-semibold text-fg hover:border-line"><Bold size={13} />Bold</button>
            <button type="button" aria-label="Make bulleted list" title="Make bulleted list" onMouseDown={(event) => event.preventDefault()} onClick={() => applyEditorCommand("insertUnorderedList")} className="inline-flex items-center gap-1 border border-transparent px-2 py-1 text-[11px] font-semibold text-fg hover:border-line"><List size={13} />Bullets</button>
            <span className="ml-auto text-[10px] text-fg-muted">Edited here</span>
          </div>
          <div
            ref={editorRef}
            role="textbox"
            aria-label="Discussion point"
            aria-multiline="true"
            contentEditable
            suppressContentEditableWarning
            onInput={(event) => onDiscussionPointChange(discussionMarkdown(event.currentTarget))}
            className="min-h-24 space-y-2 p-3 text-sm leading-relaxed text-fg focus:outline-none [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-bold [&_strong]:text-fg"
            data-placeholder="Add a short intro followed by concise bullets. Select text and use Bold to emphasize key details."
          />
        </div>
      ) : (
        <div className="space-y-2">{renderDiscussionPoint(discussionPoint)}</div>
      )}
      {onAddAction && (
        <div className="flex justify-end border-t border-line pt-3">
          <button type="button" onClick={onAddAction} className="border border-link bg-surface-panel px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:border-link hover:bg-info-surface">
            {actionCount ? "Add another action item" : "Add as action item"}
          </button>
        </div>
      )}
      {children}
    </article>
  );
}

export function MeetingSummaryEditor({
  summary,
  bottomLine,
  onChange,
  notes,
  transcript,
}: {
  summary: string;
  bottomLine: string;
  onChange: (summary: string, bottomLine: string) => void;
  notes: string;
  transcript: string;
}) {
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState("");
  const [refinementStyle, setRefinementStyle] = useState<"balanced" | "concise" | "decision-focused" | "detail-preserving">("balanced");
  const { runStructured } = useEchoAI();

  const handleRefine = async () => {
    setRefining(true);
    setError("");
    try {
      const refined = await runStructured<{ summary: string; bottom_line: string }>(
        `Refine this meeting summary using the ${refinementStyle} style. Meeting notes are the primary source of truth; use the transcript only to add supported detail. Do not invent facts, decisions, dates, or owners. Return an object with concise string fields "summary" and "bottom_line".`,
        `Current summary:\n${summary}\n\nCurrent bottom line:\n${bottomLine}\n\nMeeting notes:\n${notes}\n\nTranscript:\n${transcript}`,
      );
      onChange(String(refined.summary || ""), String(refined.bottom_line || ""));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not refine the meeting summary.");
    } finally {
      setRefining(false);
    }
  };

  return (
    <section className="space-y-4 border border-line bg-surface-panel p-5 shadow-2xs" aria-label="Meeting summary">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
        <div>
          <h3 className="font-serif text-lg italic text-fg">Meeting Summary</h3>
          <p className="mt-1 text-xs text-fg-muted">Meeting notes guide the summary; transcript details support them.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-[10px] font-bold uppercase tracking-wider text-fg-muted">
            Refinement style
            <select
              aria-label="Refinement style"
              value={refinementStyle}
              onChange={(event) => setRefinementStyle(event.target.value as typeof refinementStyle)}
              disabled={refining}
              className="min-h-9 border border-line bg-surface-panel px-2 text-xs font-medium normal-case tracking-normal text-fg focus:border-focus focus:outline-none"
            >
              <option value="balanced">Balanced</option>
              <option value="concise">More concise</option>
              <option value="decision-focused">Decisions and outcomes</option>
              <option value="detail-preserving">Preserve more detail</option>
            </select>
          </label>
          <button type="button" onClick={() => void handleRefine()} disabled={refining || (!notes.trim() && !transcript.trim())} aria-busy={refining} className="inline-flex min-h-9 items-center gap-2 border border-link px-3 py-2 text-xs font-semibold text-fg transition-colors hover:border-link hover:bg-info-surface disabled:cursor-not-allowed ">
            {refining ? "Refining summary…" : "Refine with AI"}
          </button>
        </div>
      </header>
      {!notes.trim() && !transcript.trim() && <p className="text-xs text-fg-muted">Add meeting notes or a transcript to enable AI refinement.</p>}
      {error && <p role="alert" className="border-l-2 border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-fg">{error}</p>}
      <label className="block text-[10px] font-bold uppercase tracking-wider text-fg-muted" htmlFor="meeting-summary-input">Summary</label>
      <AutoResizeTextarea label="Summary" id="meeting-summary-input" rows={3} className="w-full border border-line bg-surface-panel p-3 text-sm leading-relaxed text-fg focus:border-focus focus:outline-none" value={summary} onChange={(value) => onChange(value, bottomLine)} placeholder="Briefly summarize the meeting purpose and main subjects." />
      <label className="block text-[10px] font-bold uppercase tracking-wider text-fg-muted" htmlFor="meeting-bottom-line-input">Bottom line</label>
      <AutoResizeTextarea label="Bottom line" id="meeting-bottom-line-input" rows={2} className="w-full border border-line bg-surface-panel p-3 text-sm leading-relaxed text-fg focus:border-focus focus:outline-none" value={bottomLine} onChange={(value) => onChange(summary, value)} placeholder="State the overall outcome, decision, or what remains unresolved." />
    </section>
  );
}

export function MeetingActionItemsTable({ items, members = [], onChange, renderAction }: MeetingActionItemsTableProps) {
  if (items.length === 0) {
    return <p className="border border-dashed border-line bg-surface-panel p-6 text-center text-sm text-fg-muted">No action items recorded.</p>;
  }

  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <article key={item.id} className="border border-line bg-surface-panel p-5 shadow-2xs">
          <header className="mb-3 flex items-center gap-3 border-b border-line pb-3">
            <span className="font-serif text-xl text-link">{String(index + 1).padStart(2, "0")}</span>
            <h4 className="font-serif text-base font-bold italic text-fg">{item.discussionPointTitle || "Action item"}</h4>
          </header>
          <div className="grid grid-cols-1 gap-4 border-t border-line pt-3 md:grid-cols-2 xl:grid-cols-[1.8fr_1.1fr_0.7fr_0.8fr]">
            <section className="min-w-0">
              <h5 className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-fg-muted">Discussion Point</h5>
              <p className="min-h-10 whitespace-pre-line border border-line bg-surface-panel p-2.5 text-sm leading-relaxed text-fg">{item.discussionPoint || "Discussion removed"}</p>
            </section>
            {actionFields.map(({ label, field }) => (
              <section key={field} className="min-w-0">
                <h5 className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-fg-muted">{label}</h5>
                {field === "actionPlan" ? (
                  onChange ? <AutoResizeTextarea label={label} value={item.actionPlan} onChange={(value) => onChange(item.id, field, value)} />
                    : <p className="min-h-10 whitespace-pre-line border border-line bg-surface-panel p-2.5 text-sm leading-relaxed text-fg">{item.actionPlan || "—"}</p>
                ) : field === "targetDate" ? (
                  onChange ? (
                    <input
                      aria-label={label}
                      type="date"
                      value={item.targetDate}
                      onChange={(event) => onChange(item.id, field, event.target.value)}
                      className="w-full border-b border-line bg-transparent px-1 py-2 text-sm font-medium text-fg focus:border-focus focus:outline-none"
                    />
                  ) : <p className="min-h-10 border-b border-line px-1 py-2 text-sm text-fg">{item.targetDate || "—"}</p>
                ) : (
                  <>
                    {onChange ? (
                      <input
                        aria-label={label}
                        value={item.personInCharge}
                        onChange={(event) => {
                          const names = event.target.value.split(/[,;\n]/).map((name) => name.trim().toLowerCase());
                          const assigneeIds = (item.assigneeIds || (item.assigneeId ? [item.assigneeId] : [])).filter((id) => {
                            const memberName = members.find((member) => String(member.id) === String(id))?.username;
                            return !memberName || names.includes(memberName.toLowerCase());
                          });
                          onChange(item.id, field, event.target.value, assigneeIds);
                        }}
                        placeholder="Enter a name or choose a ClickUp member"
                        className="mb-2 w-full border-b border-line bg-transparent px-1 py-2 text-sm font-medium text-fg focus:border-focus focus:outline-none"
                      />
                    ) : <p className="min-h-10 border-b border-line px-1 py-2 text-sm text-fg">{item.personInCharge || "—"}</p>}
                    {onChange && (
                      <SearchableMemberMultiSelect
                        members={members}
                        selectedMemberIds={item.assigneeIds || (item.assigneeId ? [item.assigneeId] : [])}
                        onChange={(assigneeIds) => {
                          const oldIds = item.assigneeIds || (item.assigneeId ? [item.assigneeId] : []);
                          const oldNames = oldIds.map((id) => members.find((member) => String(member.id) === String(id))?.username).filter((name): name is string => Boolean(name));
                          const freeTextNames = item.personInCharge.split(/[,;\n]/).map((name) => name.trim()).filter((name) => name && !oldNames.some((oldName) => oldName.toLowerCase() === name.toLowerCase()));
                          const selectedNames = assigneeIds.map((id) => members.find((candidate) => String(candidate.id) === String(id))?.username).filter((name): name is string => Boolean(name));
                          const names = [...freeTextNames, ...selectedNames];
                          onChange(item.id, field, names.join(", "), assigneeIds);
                        }}
                        placeholder="Choose ClickUp members"
                        searchPlaceholder="Search ClickUp members..."
                      />
                    )}
                  </>
                )}
              </section>
            ))}
          </div>
          <footer className="mt-4 flex justify-end border-t border-line pt-3">{renderAction?.(item)}</footer>
        </article>
      ))}
    </div>
  );
}
