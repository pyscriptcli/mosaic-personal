"use client";

import React, { useEffect, useRef, useState } from "react";
import { BookOpen, Clock, ExternalLink, Maximize2, Minimize2, RotateCcw, Send, Sparkles, Square, User, X } from "lucide-react";
import { askEcho } from "@/lib/api";
import type { ArchivedMeeting } from "@/features/meetings/types/meeting";
import type { AskEchoResponse } from "@/features/ask-echo/lib/schema";
import { CodexChatPane } from "@/features/ask-echo/components/CodexChatPane";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  response?: AskEchoResponse;
}

interface UniversalEchoDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  meetings: ArchivedMeeting[];
  onOpenSource?: (page: string, recordId: string, url?: string) => void;
}

const STARTER: Message = { role: "assistant", content: "Hi — I’m Echo. What would you like to get done today?", timestamp: "Just now" };
const STORAGE_KEY = "echo_ask_conversation";
const desktopMode = process.env.NEXT_PUBLIC_MOSAIC_DESKTOP === "1";

export function UniversalEchoDrawer({ isOpen, onClose, onOpenSource }: UniversalEchoDrawerProps) {
  const [messages, setMessages] = useState<Message[]>(() => {
    if (desktopMode) return [STARTER];
    try {
      const stored = typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_KEY) : null;
      return stored ? JSON.parse(stored) : [STARTER];
    } catch {
      return [STARTER];
    }
  });
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [chatTab, setChatTab] = useState<"echo" | "codex">("echo");
  const [userName, setUserName] = useState("");
  const [conversationLoaded, setConversationLoaded] = useState(!desktopMode);
  const [openSources, setOpenSources] = useState<Record<number, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const syncConversation = (event: Event) => {
      const nextMessages = (event as CustomEvent<Message[]>).detail;
      if (Array.isArray(nextMessages)) setMessages(nextMessages);
    };
    window.addEventListener("echo-conversation-updated", syncConversation);
    return () => window.removeEventListener("echo-conversation-updated", syncConversation);
  }, []);
  useEffect(() => {
    if (desktopMode) {
      fetch("/api/local/conversations", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => {
        if (Array.isArray(data?.messages) && data.messages.length) setMessages(data.messages);
        setConversationLoaded(true);
      }).catch(() => setConversationLoaded(true));
    }
  }, []);
  useEffect(() => {
    if (desktopMode) {
      if (conversationLoaded) void fetch("/api/local/conversations", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages }) });
      return;
    }
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages)); } catch {}
  }, [messages, conversationLoaded]);
  useEffect(() => { if (!isOpen || desktopMode) return; fetch("/api/auth/me").then((response) => response.json()).then((data) => setUserName(data.user?.username || "")).catch(() => {}); }, [isOpen]);
  useEffect(() => { const key = (event: KeyboardEvent) => event.key === "Escape" && isOpen && onClose(); window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, [isOpen, onClose]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView?.({ behavior: "smooth" }); }, [messages, isThinking]);

  const quickPrompts = ["What needs my attention today?", "Show me my open tasks", "What changed this week?", "Give me my daily brief"];

  const send = async (suggestion?: string) => {
    const question = (suggestion || input).trim();
    if (!question || isThinking) return;
    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const nextMessages = [...messages, { role: "user" as const, content: question, timestamp }];
    setMessages(nextMessages); setInput(""); setIsThinking(true); setShowSuggestions(false);
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const conversation = nextMessages.slice(1, -1).map(({ role, content }) => ({ role, content }));
      const response = await askEcho(question, conversation, controller.signal);
      setMessages((current) => [...current, { role: "assistant", content: response.answer, response, timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }]);
    } catch (error) {
      const content = error instanceof DOMException && error.name === "AbortError" ? "Stopped." : error instanceof Error ? error.message : "I couldn’t answer that. Please try again.";
      setMessages((current) => [...current, { role: "assistant", content, timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }]);
    } finally { setIsThinking(false); abortRef.current = null; }
  };

  const reset = () => { abortRef.current?.abort(); setMessages([STARTER]); setInput(""); setShowSuggestions(true); if (desktopMode) void fetch("/api/local/conversations", { method: "DELETE" }); else sessionStorage.removeItem(STORAGE_KEY); };
  const renderInline = (message: Message, text: string, lineKey: string, messageIndex: number) => {
    const citations = message.response?.citations || [];
    return text.split(/(\[\d+\])/g).map((part, index) => {
      const match = part.match(/^\[(\d+)\]$/);
      if (!match) return <React.Fragment key={index}>{part}</React.Fragment>;
      const number = Number(match[1]);
      const citation = citations.find((item) => item.marker === `[${number}]`) || citations[number - 1];
      const source = citation ? message.response?.sources.find((item) => item.sourceId === citation.sourceId) : message.response?.sources[number - 1];
      return <button key={`${lineKey}-${index}`} type="button" aria-label={`Open source ${number}`} disabled={!source} onClick={() => { if (source?.sourceId.startsWith("current-meeting:")) setOpenSources((current) => ({ ...current, [messageIndex]: true })); else if (source) onOpenSource?.(source.page || "meetings", source.meetingId, source.url); }} className="align-super mx-0.5 text-[10px] font-semibold text-[#75beff] underline decoration-[#75beff] underline-offset-2 disabled:cursor-default">[{number}]</button>;
    });
  };
  const renderAnswer = (message: Message, messageIndex: number) => message.content.split("\n").map((line, index) => {
    const cleaned = line.replace(/\*\*/g, "").trim();
    if (!cleaned) return <div key={index} className="h-2" />;
    const isBullet = /^[-•]\s/.test(cleaned);
    const content = isBullet ? cleaned.replace(/^[-•]\s*/, "") : cleaned;
    return <div key={index} className={`${isBullet ? "flex gap-2 pl-1" : ""} ${/^(your |today|summary|open items|next steps|deadlines|decisions)/i.test(content) ? "font-medium text-[#e3e3e3]" : ""}`}>{isBullet && <span className="text-[#75beff]">•</span>}<span>{renderInline(message, content, String(index), messageIndex)}</span></div>;
  });
  return (
    <div className={`${isOpen ? "fixed" : "hidden"} inset-0 z-50 flex justify-end overflow-hidden`}>
      <button aria-label="Close Ask Echo" onClick={onClose} className="fixed inset-0 hidden bg-black/60 backdrop-blur-[2px] max-md:block" />
      <section aria-label="Ask Echo" className={`codex-chat relative flex h-full w-full flex-col border-l border-[#3c3c3c] bg-[#1e1e1e] text-[#cccccc] shadow-2xl transition-[width] duration-300 md:max-w-none ${expanded ? "md:w-full" : "md:w-[min(520px,34vw)]"}`}>
        <header className="flex min-h-14 items-center justify-between border-b border-[#3c3c3c] bg-[#252526] px-4">
          {desktopMode ? <div className="flex items-center gap-1" role="tablist" aria-label="Chat assistant">
            <button type="button" role="tab" aria-selected={chatTab === "echo"} onClick={() => setChatTab("echo")} className={`flex items-center gap-2 rounded px-3 py-2 text-xs ${chatTab === "echo" ? "bg-[#37373d] text-white" : "text-[#b0b0b0] hover:bg-[#2d2d30] hover:text-white"}`}><Sparkles size={14} className="text-[#75beff]" />Ask Echo</button>
            <button type="button" role="tab" aria-selected={chatTab === "codex"} onClick={() => setChatTab("codex")} className={`flex items-center gap-2 rounded px-3 py-2 text-xs ${chatTab === "codex" ? "bg-[#37373d] text-white" : "text-[#b0b0b0] hover:bg-[#2d2d30] hover:text-white"}`}><span className="font-semibold text-[#75beff]">C</span>Codex</button>
          </div> : <div className="flex items-center gap-2.5">
            <Sparkles size={16} className="text-[#75beff]" />
            <div><h2 className="text-sm font-semibold">Ask Echo</h2><p className="text-[11px] text-[#b0b0b0]">{userName ? `Workspace assistant · ${userName}` : "Workspace assistant"}</p></div>
          </div>}
          <div className="flex items-center gap-1">
            {chatTab === "echo" && <button type="button" onClick={reset} aria-label="Reset conversation" title="Reset conversation" className="rounded p-2 text-[#bdbdbd] hover:bg-[#3c3c3c] hover:text-white"><RotateCcw size={14} /></button>}
            <button type="button" onClick={() => setExpanded(!expanded)} aria-label={expanded ? "Close full view" : "Open full view"} className="rounded p-2 text-[#bdbdbd] hover:bg-[#3c3c3c] hover:text-white">{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded p-2 text-[#bdbdbd] hover:bg-[#3c3c3c] hover:text-white"><X size={16} /></button>
          </div>
        </header>

        {desktopMode && <CodexChatPane visible={chatTab === "codex"} />}
        <div className={`${chatTab === "echo" ? "flex" : "hidden"} min-h-0 flex-1 flex-col`}>
        <div className="flex-1 space-y-5 overflow-y-auto bg-[#1e1e1e] px-4 py-5 sm:px-6">
          {messages.map((message, index) => <div key={`${index}-${message.timestamp}`} className={`flex min-w-0 gap-3 ${message.role === "user" ? "flex-row-reverse" : ""}`}>
            <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${message.role === "assistant" ? "bg-[#2d2d30] text-[#75beff]" : "bg-[#37373d] text-[#cccccc]"}`}>{message.role === "assistant" ? <Sparkles size={13} /> : <User size={13} />}</div>
            <div className={`min-w-0 whitespace-normal [overflow-wrap:anywhere] text-sm leading-6 ${message.role === "assistant" ? "flex-1 py-1 text-[#cccccc]" : "w-fit max-w-[86%] rounded-2xl bg-[#2d2d30] px-4 py-3 text-[#e3e3e3]"}`}>
              <div className="space-y-1">{message.role === "assistant" ? renderAnswer(message, index) : message.content}</div>
              {message.response?.sources?.length ? <div className="mt-4 border-t border-[#C9A84C]/40 pt-3"><button type="button" onClick={() => setOpenSources((current) => ({ ...current, [index]: !current[index] }))} className="flex w-full items-center justify-between text-left text-[10px] font-medium tracking-[0.2em] uppercase text-[#003366]"><span>Sources · {message.response.sources.length}</span><span className="text-xs normal-case tracking-normal">{openSources[index] ? "Hide" : "Show"}</span></button>{openSources[index] && <div className="mt-3 space-y-2">{message.response.sources.map((source, sourceIndex) => { const currentMeeting = source.sourceId.startsWith("current-meeting:"); return <button key={source.sourceId} type="button" disabled={currentMeeting} onClick={() => onOpenSource?.(source.page || "meetings", source.meetingId, source.url)} className="block w-full text-left border-l-2 border-[#C9A84C] pl-3 py-2 enabled:hover:bg-[#003366]/5 disabled:cursor-default"><span className="flex items-center justify-between gap-2 text-xs font-medium text-[#003366]"><span><span className="mr-2 text-[10px] text-[#C9A84C]">[{sourceIndex + 1}]</span>{source.meetingTitle}</span>{!currentMeeting && <ExternalLink size={11} />}</span><span className="block text-[10px] uppercase tracking-wide text-[#003366]/55">{currentMeeting ? "Processed audio" : (source.page || "workspace")}{source.meetingDate ? ` · ${source.meetingDate}` : ""}{source.topic ? ` · ${source.topic}` : ""}</span><span className="block mt-1 text-xs text-[#181D1E]/80">{source.excerpt}</span></button>; })}</div>}</div> : null}
              {message.response?.followUps?.length ? <div className="mt-3 flex flex-wrap gap-2">{message.response.followUps.map((followUp) => <button key={followUp} type="button" onClick={() => send(followUp)} className="border border-[#003366]/25 px-2 py-1 text-[11px] text-[#003366] hover:border-[#C9A84C]">{followUp}</button>)}</div> : null}
              <div className={`text-[9px] mt-2 flex items-center gap-1 ${message.role === "user" ? "justify-end text-[#FFFCFB]/60" : "text-[#181D1E]/45"}`}><Clock size={10} />{message.timestamp}</div>
            </div>
          </div>)}
          {isThinking && <div className="flex gap-3"><div className="w-7 h-7 bg-[#003366] text-[#C9A84C] flex items-center justify-center"><Sparkles size={13} /></div><div className="border border-[#003366]/15 p-3 text-sm text-[#181D1E]/60">Looking through your meetings…</div></div>}
          <div ref={messagesEndRef} />
        </div>

        <footer className="shrink-0 border-t border-[#3c3c3c] bg-[#1e1e1e] px-3 pb-3 pt-2 sm:px-4">
          {showSuggestions && <div className="mb-2 grid grid-cols-2 gap-1.5">{quickPrompts.map((prompt) => <button key={prompt} type="button" onClick={() => send(prompt)} disabled={isThinking} className="rounded-lg border border-[#3c3c3c] bg-[#252526] px-2.5 py-2 text-left text-[11px] text-[#c5c5c5] hover:border-[#5a5a5a] hover:bg-[#2d2d30]">{prompt}</button>)}</div>}
          <form onSubmit={(event) => { event.preventDefault(); send(); }} className="rounded-xl border border-[#4a4a4a] bg-[#252526] p-2 focus-within:border-[#0078d4]">
            <textarea aria-label="Message Ask Echo" rows={2} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="Message Echo" disabled={isThinking} className="max-h-32 min-h-12 w-full resize-y bg-transparent px-2 py-1.5 text-sm leading-5 text-[#e3e3e3] outline-none placeholder:text-[#858585]" />
            <div className="flex items-center gap-1 px-1 pt-1">
              <button type="button" onClick={() => setShowSuggestions(!showSuggestions)} aria-label={showSuggestions ? "Hide prompt suggestions" : "Show prompt suggestions"} title="Prompt suggestions" className="rounded-md p-1.5 text-[#a0a0a0] hover:bg-[#3c3c3c] hover:text-white"><BookOpen size={15} /></button>
              <span className="ml-1 text-[10px] text-[#858585]">Enter to send · Shift+Enter for newline</span>
              {isThinking ? <button type="button" onClick={() => abortRef.current?.abort()} aria-label="Stop response" className="ml-auto rounded-lg bg-[#3c3c3c] p-2 text-white hover:bg-[#4a4a4a]"><Square size={14} /></button> : <button type="submit" disabled={!input.trim()} aria-label="Send message" className="ml-auto rounded-lg bg-[#0078d4] p-2 text-white hover:bg-[#1683d8] disabled:bg-[#3c3c3c] disabled:text-[#858585]"><Send size={15} /></button>}
            </div>
          </form>
          <p className="mt-2 text-center text-[10px] text-[#858585]">{desktopMode ? "Uses information stored on this device." : "Uses information available in your workspace."}</p>
        </footer>
        </div>
      </section>
    </div>
  );
}
