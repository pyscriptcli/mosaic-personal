"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ArrowRight, Download, ExternalLink, Loader2, Mail, X } from "lucide-react";
import { downloadBlob, requestMeetingPdf } from "@/lib/api";
import { createMeetingEmailDraft, createOutlookComposeUrl, isValidRecipientList, OutlookMeetingDraft } from "@/lib/outlookCompose";

interface EmailMeetingModalProps {
  isOpen: boolean;
  meeting: { title?: string; date?: string; metadata: any; items: any[]; action_items: any[]; summary?: string };
  fromEmail?: string;
  onClose: () => void;
}

export function EmailMeetingModal({ isOpen, meeting, fromEmail, onClose }: EmailMeetingModalProps) {
  const [draft, setDraft] = useState<OutlookMeetingDraft>(() => createMeetingEmailDraft(meeting));
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const [isPreparing, setIsPreparing] = useState(false);
  const [outlookUrl, setOutlookUrl] = useState("");
  const [popupBlocked, setPopupBlocked] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setDraft(createMeetingEmailDraft(meeting));
      setFilename("");
      setError("");
      setOutlookUrl("");
      setPopupBlocked(false);
    }
  }, [isOpen, meeting.title, meeting.date]);

  if (!isOpen) return null;

  const updateDraft = (key: keyof OutlookMeetingDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  const handleDownload = async () => {
    setError("");
    setIsPreparing(true);
    try {
      const { blob, filename: generatedFilename } = await requestMeetingPdf(meeting.metadata, meeting.items, meeting.action_items, meeting.summary || "", "");
      downloadBlob(blob, generatedFilename);
      setFilename(generatedFilename);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not prepare the PDF.");
    } finally {
      setIsPreparing(false);
    }
  };

  const handleSendViaEmail = () => {
    if (!filename) return;
    if (!isValidRecipientList(draft.to)) {
      setError("Enter at least one valid email address in To.");
      return;
    }
    if (draft.cc.trim() && !isValidRecipientList(draft.cc)) {
      setError("Check the CC email addresses.");
      return;
    }
    setError("");
    const url = createOutlookComposeUrl(draft);
    setOutlookUrl(url);
    setPopupBlocked(false);
    const popup = window.open(url, "echo-outlook-compose");
    if (!popup) {
      setPopupBlocked(true);
      setError("Your browser blocked Outlook. Use the fallback link below.");
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim p-4" role="dialog" aria-modal="true" aria-labelledby="email-meeting-title">
      <div className="w-full max-w-xl border border-line bg-surface-panel shadow-2xl">
        <div className="flex items-start justify-between border-b border-line px-5 py-4">
          <div><div className="flex items-center gap-2 text-fg"><Mail size={17} className="text-link" /><h2 id="email-meeting-title" className="font-serif text-lg font-bold italic">Email meeting minutes</h2></div><p className="mt-1 text-[11px] text-fg-muted">Mosaic opens Outlook with the message ready for your review.</p></div>
          <button type="button" onClick={onClose} disabled={isPreparing} aria-label="Close email dialog" className="text-fg-muted hover:text-fg "><X size={17} /></button>
        </div>
        <div className="space-y-3 p-5">
          <div className="border border-warning-border bg-surface-selected px-3 py-2 text-[11px] text-fg-secondary"><b className="text-fg">From:</b> {fromEmail || "ClickUp user email unavailable"}</div>
          <label className="block text-xs font-semibold text-fg">To<input value={draft.to} onChange={(e) => updateDraft("to", e.target.value)} placeholder="recipient@company.com" className="mt-1 w-full border border-line bg-surface-panel px-3 py-2 text-xs outline-none focus:border-focus" autoFocus /></label>
          <label className="block text-xs font-semibold text-fg">CC <span className="font-normal text-fg-muted">(optional)</span><input value={draft.cc} onChange={(e) => updateDraft("cc", e.target.value)} placeholder="manager@company.com" className="mt-1 w-full border border-line bg-surface-panel px-3 py-2 text-xs outline-none focus:border-focus" /></label>
          <label className="block text-xs font-semibold text-fg">Subject<input value={draft.subject} onChange={(e) => updateDraft("subject", e.target.value)} className="mt-1 w-full border border-line bg-surface-panel px-3 py-2 text-xs outline-none focus:border-focus" /></label>
          <label className="block text-xs font-semibold text-fg">Message<textarea value={draft.body} onChange={(e) => updateDraft("body", e.target.value)} rows={6} className="mt-1 w-full resize-y border border-line bg-surface-panel px-3 py-2 text-xs leading-relaxed outline-none focus:border-focus" /></label>
          <div className="border border-line bg-surface-raised px-3 py-2 text-[11px] text-fg-secondary"><b className="text-fg">Next:</b> Download the PDF first, then open the prefilled Outlook draft and attach it manually.</div>
          {error && <div className="flex items-start gap-2 border border-danger-border bg-danger-surface px-3 py-2 text-[11px] text-danger-fg"><AlertCircle size={14} className="mt-0.5 shrink-0" />{error}</div>}
          {filename && <div className="flex items-center gap-2 border border-success-border bg-success-surface px-3 py-2 text-[11px] text-success-fg"><Download size={14} /><span><b>PDF downloaded:</b> {filename}. Attach it in the Outlook draft before sending.</span></div>}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3"><button type="button" onClick={onClose} disabled={isPreparing} className="border border-line px-3 py-2 text-xs font-semibold text-fg-secondary">{filename ? "Done" : "Cancel"}</button><button type="button" onClick={handleDownload} disabled={isPreparing || !!filename} className="flex items-center gap-2 border border-link bg-surface-panel px-4 py-2 text-xs font-bold text-fg disabled:cursor-not-allowed ">{isPreparing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} className="text-link" />}{isPreparing ? "Downloading…" : filename ? "MoM PDF Downloaded" : "Download MoM PDF"}</button><ArrowRight size={16} className={filename ? "text-link" : "text-fg-muted"} aria-hidden="true" /><button type="button" onClick={handleSendViaEmail} disabled={!filename || isPreparing} className="flex items-center gap-2 bg-action px-4 py-2 text-xs font-bold text-on-action disabled:cursor-not-allowed " title={!filename ? "Download the MoM PDF first" : "Open the prefilled Outlook draft"}><Mail size={14} className="text-link" />Send via Email</button>{popupBlocked && outlookUrl && <a href={outlookUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 border border-link px-3 py-2 text-[11px] font-semibold text-fg hover:bg-info-surface">Open Outlook <ExternalLink size={12} /></a>}</div>
        </div>
      </div>
    </div>
  );
}
