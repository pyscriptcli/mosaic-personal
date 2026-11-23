"use client";

import React, { useEffect, useState } from "react";
import { 
  X, 
  Search, 
  Sparkles, 
  Zap, 
  Plus, 
  Loader2,
} from "lucide-react";
import type { DiscoveredTopicItem } from "@/app/api/discover-topics/route";

function renderDiscussionText(text: string) {
  return <div className="space-y-1">{text.replace(/\\+\*/g, "*").split(/\r?\n/).filter(Boolean).map((rawLine, lineIndex) => {
    const line = rawLine.trim().replace(/\\-/g, "-");
    const bullet = line.trim().match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    const value = bullet?.[1] || line.trim();
    const parts = value.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, partIndex) => part.startsWith("**") && part.endsWith("**") ? <strong key={partIndex} className="font-bold text-fg">{part.slice(2, -2)}</strong> : <React.Fragment key={partIndex}>{part}</React.Fragment>);
    return bullet ? <p key={lineIndex} className="pl-3 before:mr-2 before:text-link before:content-['•']">{parts}</p> : <p key={lineIndex}>{parts}</p>;
  })}</div>;
}

interface DiscoverTopicsModalProps {
  isOpen: boolean;
  onClose: () => void;
  missedTopics: DiscoveredTopicItem[];
  isDiscoveringTopics: boolean;
  autoDiscoverEnabled: boolean;
  onToggleAutoDiscover: () => void;
  topicQuery: string;
  onTopicQueryChange: (query: string) => void;
  onDiscoverTopics: (query?: string) => void;
  onAddTopic: (index: number) => void;
  onAddAction?: (index: number) => void;
  onAddAllActions?: () => void;
  onAddAllTopics: () => void;
  onDismissTopic: (index: number) => void;
  transcript: string;
}

export function DiscoverTopicsModal({
  isOpen,
  onClose,
  missedTopics,
  isDiscoveringTopics,
  autoDiscoverEnabled,
  onToggleAutoDiscover,
  topicQuery,
  onTopicQueryChange,
  onDiscoverTopics,
  onAddTopic,
  onAddAction,
  onAddAllActions,
  onAddAllTopics,
  onDismissTopic,
  transcript,
}: DiscoverTopicsModalProps) {
  const [activeTab, setActiveTab] = useState<"topics" | "actions">("topics");
  const topicRows = missedTopics.map((topic, index) => ({ topic, index }));
  const actionRows = missedTopics
    .map((topic, index) => ({ topic, index }))
    .filter(({ topic }) => Boolean(topic.action_plan && topic.action_plan !== "None"));
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60 backdrop-blur-xs p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="discover-topics-title"
    >
      <div 
        className="w-full max-w-4xl max-h-[90vh] flex flex-col bg-surface-panel border border-link shadow-2xl rounded-none overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="px-5 py-3.5 bg-action text-on-action flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 bg-warning-surface"></div>
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-link" />
              <h2 id="discover-topics-title" className="text-xs font-bold uppercase tracking-[0.2em]">
                Discover & Search Discussion Points
              </h2>
            </div>
            <span className="text-[11px] text-fg-muted font-semibold tracking-wider">
              {isDiscoveringTopics ? (
                <span className="text-link font-bold inline-flex items-center gap-1.5 ml-2">
                  <Loader2 size={12} className="animate-spin" /> Scanning transcript...
                </span>
              ) : (
                <span className="ml-1 text-fg-muted">
                  ({missedTopics.length} {missedTopics.length === 1 ? "discussion point" : "discussion points"} suggested)
                </span>
              )}
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Auto-Discover Toggle */}
            <button
              type="button"
              onClick={onToggleAutoDiscover}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium transition-colors border ${
                autoDiscoverEnabled
                  ? "bg-surface-panel text-on-action border-control-border font-semibold"
                  : "bg-surface-panel text-fg-muted border-control-border"
              }`}
              title={autoDiscoverEnabled ? "Auto-discover is active for new transcripts" : "Auto-discover is paused"}
            >
              <Zap size={11} className={autoDiscoverEnabled ? "text-link fill-focus" : "text-fg-muted"} />
              <span>Auto-Discover: <strong>{autoDiscoverEnabled ? "ON" : "OFF"}</strong></span>
            </button>

            {/* Add All Button */}
            {activeTab === "topics" && missedTopics.length > 1 && (
              <button
                type="button"
                onClick={onAddAllTopics}
                className="bg-warning-surface text-fg hover:bg-warning-surface px-3 py-1 text-[11px] font-bold uppercase tracking-wider rounded-none shadow-2xs inline-flex items-center gap-1 transition-colors"
              >
                <Plus size={12} /> Add All ({missedTopics.length}) Discussion Points
              </button>
            )}
            {activeTab === "actions" && actionRows.length > 1 && (
              <button type="button" onClick={onAddAllActions} className="bg-warning-surface px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-fg hover:bg-warning-surface">
                <Plus size={12} className="mr-1 inline" /> Add All ({actionRows.length}) Action Items
              </button>
            )}

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors ml-1"
              aria-label="Close dialog"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Search & Action Input Bar */}
        <div className="p-4 border-b border-line bg-surface-panel shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!isDiscoveringTopics && transcript) {
                onDiscoverTopics(topicQuery);
              }
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input
                value={topicQuery}
                onChange={(e) => onTopicQueryChange(e.target.value)}
                placeholder="Find a discussion point in the transcript (e.g., 'reclamation', 'service agreement')..."
                className="w-full pl-9 pr-8 py-2 text-xs bg-surface-panel border border-line focus:outline-none focus:border-focus transition-colors rounded-none placeholder:text-fg-muted"
              />
              {topicQuery && (
                <button
                  type="button"
                  onClick={() => onTopicQueryChange("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg-secondary p-0.5"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                type="submit"
                disabled={isDiscoveringTopics || !transcript}
                className="btn-primary !py-2 !px-4 !text-xs rounded-none inline-flex items-center justify-center gap-1.5"
              >
                {isDiscoveringTopics ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                {topicQuery.trim() ? "Search Topic" : "Discover Topics"}
              </button>
              <button
                type="button"
                onClick={() => onDiscoverTopics("")}
                disabled={isDiscoveringTopics || !transcript}
                className="btn-outline !py-2 !px-3.5 !text-xs rounded-none inline-flex items-center justify-center gap-1.5 text-fg hover:text-fg"
                title="Scan transcript for important discussion points not already captured"
              >
                <Sparkles size={13} className="text-link" />
                Auto-Discover
              </button>
            </div>
          </form>
        </div>

        <div role="tablist" aria-label="Discovered meeting items" className="flex border-b border-line bg-surface-panel px-4">
          <button type="button" role="tab" aria-selected={activeTab === "topics"} onClick={() => setActiveTab("topics")} className={`border-b-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider ${activeTab === "topics" ? "border-link text-fg" : "border-transparent text-fg-muted"}`}>
            Topics ({topicRows.length})
          </button>
          <button type="button" role="tab" aria-selected={activeTab === "actions"} onClick={() => setActiveTab("actions")} className={`border-b-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider ${activeTab === "actions" ? "border-link text-fg" : "border-transparent text-fg-muted"}`}>
            Action Items ({actionRows.length})
          </button>
        </div>

        {/* Scrollable Topics and Actions */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 min-h-[220px]">
          {(activeTab === "topics" ? topicRows.length === 0 : actionRows.length === 0) ? (
            <div className="text-center py-12 px-4 bg-surface-panel border border-dashed border-line">
              <Sparkles size={28} className="mx-auto text-link mb-2.5 opacity-80" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-fg">{activeTab === "topics" ? "No Uncaptured Discussion Points" : "No Explicit Action Items Found"}</h3>
              <p className="text-[11px] text-fg-muted mt-1.5 max-w-md mx-auto leading-relaxed">
                {activeTab === "topics" ? <>Find discussion points that are missing from the minutes. Search a keyword above or run <strong>Auto-Discover</strong>.</> : <>An action item appears here only when the transcript contains an explicit commitment or assigned next step. Discover more topics to check again.</>}
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => onDiscoverTopics("")}
                  disabled={isDiscoveringTopics || !transcript}
                  className="btn-primary !py-1.5 !px-3.5 !text-xs rounded-none inline-flex items-center gap-1.5"
                >
                  <Sparkles size={12} /> Run Topic Discovery Now
                </button>
              </div>
            </div>
          ) : activeTab === "topics" ? (
            <>
              <p className="text-[11px] text-fg-muted">Discussion points capture what was discussed. Add an item here to the Discussion Points tab.</p>
              {topicRows.map(({ topic, index: idx }) => (
              <div
                key={idx}
                className="p-4 bg-surface-panel border border-line shadow-2xs hover:border-link transition-all rounded-none"
              >
                {/* Topic Title & Actions Header */}
                <div className="flex items-start justify-between gap-3 pb-2.5 border-b border-line">
                  <div className="flex items-center gap-2.5 flex-wrap flex-1">
                    <span className="font-[family-name:--font-bebas] text-xl text-link tracking-wider select-none shrink-0">
                      #{String(idx + 1).padStart(2, "0")}
                    </span>
                    <h4 className="text-sm font-bold text-fg font-serif">
                      {topic.topic_title}
                    </h4>
                    {topic.confidence && (
                      <span className={`text-[9px] font-bold px-2 py-0.5 uppercase tracking-wider ${
                        topic.confidence === "High" 
                          ? "bg-warning-surface text-warning-fg"
                          : "bg-info-surface text-info-fg"
                      }`}>
                        {topic.confidence} Confidence
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onAddTopic(idx)}
                      className="btn-outline !py-1.5 !px-3 !text-xs rounded-none shadow-2xs inline-flex items-center gap-1.5 text-fg hover:bg-action-hover hover:text-fg"
                      title="Add this discussion point to the Discussion Points tab"
                    >
                      <Plus size={12} /> Add Discussion Point
                    </button>
                    <button
                      type="button"
                      onClick={() => onDismissTopic(idx)}
                      className="p-1 text-fg-muted hover:text-danger-fg hover:bg-surface-hover transition-colors"
                      title="Dismiss suggestion"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>

                {/* Evidence Quote */}
                {topic.evidence_quote && (
                  <div className="mt-3 pl-3 border-l-2 border-focus py-0.5 bg-surface-raised">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-link block mb-0.5">
                      Evidence Quote / Context Reference
                    </span>
                    <p className="text-[11px] text-fg-secondary italic">
                      &ldquo;{topic.evidence_quote}&rdquo;
                    </p>
                  </div>
                )}

                {/* Discussion Point Summary */}
                {topic.discussion_point && (
                  <div className="mt-2.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-fg-muted block mb-0.5">
                      Discussion Point
                    </span>
                    <div className="text-xs leading-relaxed text-fg">{renderDiscussionText(topic.discussion_point)}</div>
                  </div>
                )}
              </div>
              ))}
            </>
          ) : (
            <>
              <p className="text-[11px] text-fg-muted">Only explicit commitments appear here. Adding one creates a separate action item linked to its discussion point.</p>
              {actionRows.map(({ topic, index }) => (
                <article key={`${index}-${topic.topic_title}`} className="border border-line bg-surface-panel p-4 shadow-2xs">
                  <header className="flex items-start justify-between gap-3 border-b border-line pb-2.5">
                    <div><h3 className="font-serif text-sm font-bold text-fg">{topic.topic_title}</h3><p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-fg-muted">Discussion point</p><div className="mt-1 text-xs leading-relaxed text-fg">{renderDiscussionText(topic.discussion_point)}</div></div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button type="button" onClick={() => onAddAction?.(index)} className="btn-outline !py-1.5 !px-3 !text-xs rounded-none inline-flex items-center gap-1.5 text-fg"><Plus size={12} /> Add Action Item</button>
                      <button type="button" onClick={() => onDismissTopic(index)} aria-label={`Dismiss ${topic.topic_title}`} className="p-1 text-fg-muted hover:text-danger-fg"><X size={15} /></button>
                    </div>
                  </header>
                  {topic.evidence_quote && <p className="mt-3 border-l-2 border-focus bg-surface-raised px-3 py-2 text-[11px] italic leading-relaxed text-fg-secondary">{topic.evidence_quote}</p>}
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-2"><span className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Action Plan</span><p className="mt-1 text-sm leading-relaxed text-fg">{topic.action_plan}</p></div>
                    <div><span className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Target Date</span><p className="mt-1 text-xs text-fg">{topic.indicative_delivery_date === "TBD" ? "Not specified" : topic.indicative_delivery_date}</p><span className="mt-2 block text-[10px] font-bold uppercase tracking-wider text-fg-muted">Person in Charge</span><p className="mt-1 text-xs text-fg">{topic.person_in_charge === "Unassigned" ? "Unassigned" : topic.person_in_charge}</p></div>
                  </div>
                </article>
              ))}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 bg-surface-raised border-t border-line flex items-center justify-between shrink-0">
          <p className="text-[11px] text-fg-muted">
            {activeTab === "topics" ? "Adding creates a discussion point only. Add its action separately from the Action Items tab." : "Adding an action links it to its discussion point; a missing discussion point is added at the same time."}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="btn-outline !py-1.5 !px-4 !text-xs rounded-none"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
