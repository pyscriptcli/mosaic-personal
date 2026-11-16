"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Check, FolderOpen, LoaderCircle, Play, Send, ShieldAlert, Square, X } from "lucide-react";

type CodexStatus = {
  available: boolean;
  connected: boolean;
  email: string | null;
  accountType: string | null;
  planType: string | null;
  workspaceDirectory: string | null;
  error?: string;
};

type CodexMessage = { id: number; role: "user" | "assistant"; content: string; timestamp: string };
type CodexApproval = { id: string | number; method: string; params: Record<string, unknown> };
type CodexEvent = { type: string; [key: string]: unknown };
type CodexBridge = {
  getCodexStatus: () => Promise<CodexStatus>;
  chooseCodexWorkspace: () => Promise<{ workspaceDirectory: string } | null>;
  startCodexThread: () => Promise<{ threadId: string; cwd: string }>;
  sendCodexMessage: (prompt: string) => Promise<{ turnId: string | null }>;
  interruptCodexTurn: () => Promise<boolean>;
  respondToCodexApproval: (id: string | number, accepted: boolean) => Promise<boolean>;
  onCodexEvent: (listener: (payload: CodexEvent) => void) => () => void;
};

function desktopBridge() {
  return (window as Window & { mosaicDesktop?: CodexBridge }).mosaicDesktop;
}

function timeNow() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function describeApproval(approval: CodexApproval) {
  const params = approval.params;
  const command = typeof params.command === "string"
    ? params.command
    : Array.isArray(params.command) ? params.command.join(" ") : null;
  if (command) return command;
  const fileChanges = params.fileChanges;
  if (fileChanges && typeof fileChanges === "object") return Object.keys(fileChanges as Record<string, unknown>).join("\n");
  const actions = params.commandActions;
  if (Array.isArray(actions)) return actions.map((action) => typeof action === "string" ? action : JSON.stringify(action)).join("\n");
  return "Codex is requesting permission to run an action in the selected workspace.";
}

export function CodexChatPane({ visible }: { visible: boolean }) {
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [messages, setMessages] = useState<CodexMessage[]>([]);
  const [input, setInput] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState("");
  const [approval, setApproval] = useState<CodexApproval | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageSequence = useRef(0);
  const statusLabel = useMemo(() => {
    if (!status) return "Checking Codex CLI";
    if (!status.available) return "Codex CLI unavailable";
    if (!status.connected) return "Codex CLI not connected";
    return status.email || "Connected to ChatGPT";
  }, [status]);

  const refreshStatus = useCallback(async () => {
    const bridge = desktopBridge();
    if (!bridge) {
      setStatus({ available: false, connected: false, email: null, accountType: null, planType: null, workspaceDirectory: null, error: "Codex controls are available in the installed Mosaic desktop app." });
      return;
    }
    const nextStatus = await bridge.getCodexStatus();
    setStatus(nextStatus);
    if (nextStatus.error) setError(nextStatus.error);
  }, []);

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) {
      if (visible) void refreshStatus();
      return;
    }
    const unsubscribe = bridge.onCodexEvent((event) => {
      if (event.type === "account/updated") void refreshStatus();
      if (event.type === "thread/started") {
        setMessages([]);
        setApproval(null);
        setError("");
      }
      if (event.type === "item/agentMessage/delta" && typeof event.delta === "string") {
        const delta = event.delta;
        setMessages((current) => {
          const existingId = streamingMessageId;
          if (existingId !== null && current.some((message) => message.id === existingId)) {
            return current.map((message) => message.id === existingId ? { ...message, content: message.content + delta } : message);
          }
          const id = ++messageSequence.current;
          setStreamingMessageId(id);
          return [...current, { id, role: "assistant", content: delta, timestamp: timeNow() }];
        });
      }
      if (event.type === "approval") {
        setApproval({ id: event.id as string | number, method: String(event.method || ""), params: (event.params || {}) as Record<string, unknown> });
      }
      if (event.type === "turn/completed") {
        setIsWorking(false);
        setApproval(null);
        setStreamingMessageId(null);
        const turn = (event.params as { turn?: { status?: string; error?: { message?: string } | string } } | undefined)?.turn;
        if (turn?.status && turn.status !== "completed" && turn.status !== "interrupted") {
          const reason = typeof turn.error === "string" ? turn.error : turn.error?.message;
          if (reason) setError(reason);
        }
      }
      if (event.type === "process/exited") {
        setStatus((current) => current ? { ...current, available: false, error: String(event.message || "Codex CLI stopped.") } : null);
        setIsWorking(false);
      }
      if (event.type === "protocol/error" || event.type === "unsupported-request") {
        setError(String(event.message || "Codex sent a request Mosaic does not support."));
      }
    });
    if (visible) void refreshStatus().catch((nextError) => setError(nextError instanceof Error ? nextError.message : String(nextError)));
    return unsubscribe;
  }, [visible, refreshStatus, streamingMessageId]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, approval]);

  const startThread = async () => {
    const bridge = desktopBridge();
    if (!bridge) return;
    setIsStarting(true);
    setError("");
    try {
      const result = await bridge.startCodexThread();
      setStatus((current) => current ? { ...current, workspaceDirectory: result.cwd } : current);
      setMessages([]);
      setApproval(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsStarting(false);
    }
  };

  const chooseWorkspace = async () => {
    const bridge = desktopBridge();
    if (!bridge) return;
    setError("");
    try {
      const selection = await bridge.chooseCodexWorkspace();
      if (!selection) return;
      setStatus((current) => current ? { ...current, workspaceDirectory: selection.workspaceDirectory } : current);
      await startThread();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const prompt = input.trim();
    if (!prompt || isWorking || !status?.connected || !status.workspaceDirectory) return;
    const userId = ++messageSequence.current;
    setMessages((current) => [...current, { id: userId, role: "user", content: prompt, timestamp: timeNow() }]);
    setInput("");
    setIsWorking(true);
    setError("");
    try {
      await desktopBridge()?.sendCodexMessage(prompt);
    } catch (nextError) {
      setIsWorking(false);
      setStreamingMessageId(null);
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const respondToApproval = async (accepted: boolean) => {
    if (!approval) return;
    const currentApproval = approval;
    setApproval(null);
    try {
      await desktopBridge()?.respondToCodexApproval(currentApproval.id, accepted);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  return (
    <div className={`${visible ? "flex" : "hidden"} min-h-0 flex-1 flex-col bg-[#1e1e1e] text-[#cccccc]`}>
      <div className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-[#3c3c3c] bg-[#252526] px-4">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span className={`h-2 w-2 shrink-0 rounded-full ${status?.connected ? "bg-emerald-400" : status?.available === false ? "bg-[#f14c4c]" : "bg-[#cca700]"}`} />
          <span className="truncate text-[#cccccc]">{statusLabel}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => void refreshStatus()} title="Refresh Codex status" aria-label="Refresh Codex status" className="rounded p-1.5 text-[#bdbdbd] hover:bg-[#3c3c3c] hover:text-white"><LoaderCircle size={14} /></button>
          <button type="button" onClick={() => void chooseWorkspace()} title="Choose workspace folder" aria-label="Choose workspace folder" className="flex items-center gap-1.5 rounded border border-[#454545] px-2 py-1.5 text-[11px] text-[#cccccc] hover:border-[#0078d4] hover:bg-[#2d2d30]"><FolderOpen size={13} />Workspace</button>
          {status?.connected && status.workspaceDirectory && <button type="button" onClick={() => void startThread()} disabled={isStarting || isWorking} title="Start a new Codex conversation" aria-label="Start a new Codex conversation" className="rounded p-1.5 text-[#bdbdbd] hover:bg-[#3c3c3c] hover:text-white disabled:opacity-50"><Play size={14} /></button>}
        </div>
      </div>

      {status?.workspaceDirectory && <div className="truncate border-b border-[#333333] px-4 py-2 text-[11px] text-[#b0b0b0]" title={status.workspaceDirectory}>{status.workspaceDirectory}</div>}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
        {!status && <div className="flex items-center gap-2 text-sm text-[#b0b0b0]"><LoaderCircle size={15} className="animate-spin" />Connecting to Codex CLI…</div>}
        {status?.available === false && <div className="rounded-lg border border-[#5a3d1f] bg-[#2d251b] p-4 text-sm">
          <h3 className="font-semibold text-[#e6c889]">Codex CLI is not available</h3>
          <p className="mt-2 leading-6 text-[#c9c9c9]">{status.error || "Install Codex CLI, then restart Mosaic."}</p>
          <a href="https://developers.openai.com/codex/cli" target="_blank" rel="noreferrer" className="mt-3 inline-block text-[#75beff] underline underline-offset-2">Codex CLI installation guide</a>
        </div>}
        {status?.available && !status.connected && <div className="rounded-lg border border-[#3c3c3c] bg-[#252526] p-5">
          <h3 className="font-semibold text-[#e7e7e7]">Codex CLI is not connected</h3>
          <p className="mt-2 max-w-lg text-sm leading-6 text-[#b0b0b0]">Use Ask Echo for AI chat. Codex conversations are available when Codex CLI is already configured on this device.</p>
        </div>}
        {status?.connected && !status.workspaceDirectory && <div className="rounded-lg border border-[#3c3c3c] bg-[#252526] p-5">
          <h3 className="font-semibold text-[#e7e7e7]">Choose a workspace</h3>
          <p className="mt-2 text-sm leading-6 text-[#b0b0b0]">Codex can read and write files inside the folder you select. It will ask before running commands that need your approval.</p>
          <button type="button" onClick={() => void chooseWorkspace()} className="mt-4 flex items-center gap-2 rounded bg-[#0078d4] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1683d8]"><FolderOpen size={14} />Choose folder</button>
        </div>}
        {messages.length === 0 && status?.connected && status.workspaceDirectory && <div className="mx-auto mt-12 max-w-sm text-center">
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-[#252526] text-[#75beff]"><Check size={19} /></div>
          <h3 className="mt-4 text-sm font-semibold text-[#e7e7e7]">Codex is ready</h3>
          <p className="mt-2 text-xs leading-5 text-[#b0b0b0]">Ask Codex to inspect or update files in the selected workspace. You’ll review agent requests that need approval.</p>
        </div>}
        {messages.map((message) => <div key={message.id} className={`flex min-w-0 gap-3 ${message.role === "user" ? "flex-row-reverse" : ""}`}>
          <div className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${message.role === "assistant" ? "bg-[#2d2d30] text-[#75beff]" : "bg-[#37373d] text-[#e7e7e7]"}`}>{message.role === "assistant" ? "C" : "You"}</div>
          <div className={`min-w-0 max-w-[90%] whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-6 ${message.role === "assistant" ? "flex-1 py-1 text-[#d4d4d4]" : "w-fit rounded-2xl bg-[#2d2d30] px-4 py-3 text-[#e7e7e7]"}`}>
            {message.content || <span className="text-[#b0b0b0]">Working…</span>}
            <div className={`mt-2 text-[10px] ${message.role === "user" ? "text-[#b0b0b0]" : "text-[#a6a6a6]"}`}>{message.timestamp}</div>
          </div>
        </div>)}
        {approval && <div className="rounded-lg border border-[#8a6d2d] bg-[#302a1d] p-3" role="alertdialog" aria-label="Codex permission request">
          <div className="flex items-start gap-2"><ShieldAlert size={16} className="mt-0.5 shrink-0 text-[#e6c889]" /><div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-[#f2d596]">Codex requests approval</p>
            <p className="mt-1 text-[11px] leading-5 text-[#d4d4d4]">{typeof approval.params.reason === "string" ? approval.params.reason : "Review this action before Codex continues."}</p>
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-[#1e1e1e] p-2 font-mono text-[11px] leading-4 text-[#d4d4d4]">{describeApproval(approval)}</pre>
            <p className="mt-2 text-[10px] text-[#b0b0b0]">This decision applies to this request only.</p>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => void respondToApproval(false)} className="flex items-center gap-1 rounded border border-[#555555] px-2.5 py-1.5 text-[11px] text-[#d4d4d4] hover:bg-[#3c3c3c]"><X size={12} />Decline</button>
              <button type="button" onClick={() => void respondToApproval(true)} className="flex items-center gap-1 rounded bg-[#0078d4] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#1683d8]"><Check size={12} />Allow once</button>
            </div>
          </div></div>
        </div>}
        {error && <p role="status" className="rounded border border-[#6b3333] bg-[#321f1f] px-3 py-2 text-xs leading-5 text-[#f0b7b7]">{error}</p>}
        <div ref={messagesEndRef} />
      </div>

      <footer className="shrink-0 border-t border-[#3c3c3c] bg-[#1e1e1e] px-3 pb-3 pt-2 sm:px-4">
        <form onSubmit={(event) => void send(event)} className="rounded-xl border border-[#4a4a4a] bg-[#252526] p-2 focus-within:border-[#0078d4]">
          <textarea aria-label="Message Codex" rows={2} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={status?.connected && status.workspaceDirectory ? "Ask Codex to work in this folder…" : "Connect Codex and choose a workspace first"} disabled={!status?.connected || !status.workspaceDirectory || isWorking} className="max-h-32 min-h-12 w-full resize-y bg-transparent px-2 py-1.5 text-sm leading-5 text-[#e3e3e3] outline-none placeholder:text-[#a0a0a0] disabled:cursor-not-allowed" />
          <div className="flex items-center gap-2 px-1 pt-1">
            <span className="text-[10px] text-[#b0b0b0]">Enter to send · Shift+Enter for newline</span>
            {isWorking ? <button type="button" onClick={() => void desktopBridge()?.interruptCodexTurn()} aria-label="Stop Codex" className="ml-auto rounded-lg bg-[#3c3c3c] p-2 text-white hover:bg-[#4a4a4a]"><Square size={14} /></button> : <button type="submit" disabled={!input.trim() || !status?.connected || !status.workspaceDirectory} aria-label="Send to Codex" className="ml-auto rounded-lg bg-[#0078d4] p-2 text-white hover:bg-[#1683d8] disabled:bg-[#3c3c3c] disabled:text-[#b0b0b0]"><Send size={15} /></button>}
          </div>
        </form>
        <p className="mt-2 text-center text-[10px] text-[#b0b0b0]">Codex CLI runs on this device; AI responses require internet access.</p>
      </footer>
    </div>
  );
}
