"use client";

import { useEffect, useState } from "react";
import { ExternalLink, FolderOpen, RefreshCw, Save } from "lucide-react";

type WorkspaceSettings = {
  directory: string;
  supabaseConfigured: boolean;
  apiKeys: Record<string, boolean>;
  groqTranscriptionKeyCount: number;
  codexWorkspaceDirectory: string | null;
  sync: { status: string; uploaded: number; downloaded: number; deleted: number; syncedAt: string | null; error: string | null };
};

type DesktopBridge = {
  getWorkspaceSettings: () => Promise<WorkspaceSettings>;
  chooseWorkspaceFolder: () => Promise<{ directory: string } | null>;
  openWorkspaceFolder: () => Promise<string>;
  openCredentialManager: () => Promise<boolean>;
  saveSupabaseConfig: (config: { url: string; secretKey: string }) => Promise<{ configured: boolean }>;
  saveApiKey: (provider: string, key: string) => Promise<WorkspaceSettings>;
  importGroqTranscriptionKeys: () => Promise<{ importedCount: number } | null>;
  syncWorkspaceNow: () => Promise<WorkspaceSettings["sync"]>;
  getCodexStatus: () => Promise<{ available: boolean; connected: boolean; email?: string | null; workspaceDirectory?: string | null; error?: string }>;
  chooseCodexWorkspace: () => Promise<{ workspaceDirectory: string } | null>;
  onSyncStatus: (listener: (status: WorkspaceSettings["sync"]) => void) => () => void;
};

function bridge() {
  return (window as Window & { mosaicDesktop?: DesktopBridge }).mosaicDesktop;
}

const providers = [
  { id: "deepseek", label: "DeepSeek" },
  { id: "openai", label: "OpenAI" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "gemini", label: "Gemini" },
];

export function SettingsPage() {
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [codex, setCodex] = useState<{ available: boolean; connected: boolean; email?: string | null; workspaceDirectory?: string | null; error?: string } | null>(null);
  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [supabaseKey, setSupabaseKey] = useState("");
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const desktop = bridge();
    if (!desktop) return;
    void Promise.all([desktop.getWorkspaceSettings(), desktop.getCodexStatus()]).then(([workspace, codexStatus]) => {
      setSettings(workspace);
      setCodex(codexStatus);
      setSupabaseUrl("");
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Settings could not load."));
    return desktop.onSyncStatus((sync) => setSettings((current) => current ? { ...current, sync } : current));
  }, []);

  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    setMessage("");
    setError("");
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The setting could not be saved."); }
    finally { setBusy(""); }
  };

  const sync = settings?.sync;
  return <section className="mx-auto w-full max-w-5xl px-6 py-8 text-fg">
    <header className="mb-8 border-b border-line pb-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-muted">Mosaic settings</p>
      <h1 className="mt-2 text-2xl font-semibold">Workspace and connections</h1>
      <p className="mt-2 max-w-2xl text-sm text-fg-muted">Your workspace files stay on this device. Optional sync copies JSON records to your Supabase project; recordings stay local.</p>
    </header>

    {message && <p role="status" className="mb-4 border border-line bg-surface-panel px-3 py-2 text-sm">{message}</p>}
    {error && <p role="alert" className="mb-4 border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger-fg">{error}</p>}

    <div className="space-y-6">
      <section className="border border-line bg-surface-panel p-5">
        <h2 className="text-sm font-semibold">Local files</h2>
        <p className="mt-1 break-all text-xs text-fg-muted">{settings?.directory || "Loading workspace path…"}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={Boolean(busy)} onClick={() => void run("folder", async () => { const result = await bridge()?.chooseWorkspaceFolder(); if (result) { setMessage("Workspace copied to the new folder."); setSettings(await bridge()?.getWorkspaceSettings() || null); } })} className="inline-flex items-center gap-2 border border-line px-3 py-2 text-xs hover:bg-surface-hover "><FolderOpen size={14} /> Change folder</button>
          <button type="button" onClick={() => void bridge()?.openWorkspaceFolder()} className="inline-flex items-center gap-2 border border-line px-3 py-2 text-xs hover:bg-surface-hover"><ExternalLink size={14} /> Open folder</button>
        </div>
      </section>

      <section className="border border-line bg-surface-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Supabase sync</h2>
            <p className="mt-1 text-xs text-fg-muted">Records sync automatically when files change. Use Sync now to run it on demand. Media files are excluded.</p>
          </div>
          <span className="text-xs text-fg-muted">{sync?.status || "idle"}</span>
        </div>
        {sync?.syncedAt && <p className="mt-2 text-xs text-fg-muted">Last sync: {new Date(sync.syncedAt).toLocaleString()} · {sync.uploaded} uploaded · {sync.downloaded} downloaded · {sync.deleted} deleted</p>}
        {sync?.error && <p className="mt-2 text-xs text-danger-fg">{sync.error}</p>}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-xs text-fg-muted">Supabase project URL<input value={supabaseUrl} onChange={(event) => setSupabaseUrl(event.target.value)} placeholder="https://your-project.supabase.co" className="mt-1 w-full border border-line bg-surface-panel px-3 py-2 text-sm text-fg outline-none focus:border-focus" /></label>
          <label className="text-xs text-fg-muted">Supabase secret key<input type="password" value={supabaseKey} onChange={(event) => setSupabaseKey(event.target.value)} placeholder={settings?.supabaseConfigured ? "Configured · enter a new key to replace" : "sb_secret_…"} autoComplete="new-password" className="mt-1 w-full border border-line bg-surface-panel px-3 py-2 text-sm text-fg outline-none focus:border-focus" /></label>
        </div>
        <p className="mt-2 text-[11px] text-fg-muted">Use a private Supabase project dedicated to this Mosaic workspace. The secret key is encrypted by Windows and used only by the desktop process.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={Boolean(busy) || !supabaseUrl || !supabaseKey} onClick={() => void run("supabase", async () => { await bridge()?.saveSupabaseConfig({ url: supabaseUrl, secretKey: supabaseKey }); setSupabaseKey(""); setSettings(await bridge()?.getWorkspaceSettings() || null); setMessage("Supabase settings saved. Sync is starting."); })} className="inline-flex items-center gap-2 bg-action px-3 py-2 text-xs font-semibold text-on-action hover:bg-action-hover "><Save size={14} /> Save connection</button>
          <button type="button" disabled={Boolean(busy) || !settings?.supabaseConfigured} onClick={() => void run("sync", async () => { const result = await bridge()?.syncWorkspaceNow(); if (result) setSettings((current) => current ? { ...current, sync: result } : current); setMessage("Sync finished."); })} className="inline-flex items-center gap-2 border border-line px-3 py-2 text-xs hover:bg-surface-hover "><RefreshCw size={14} /> Sync now</button>
        </div>
      </section>

      <section className="border border-line bg-surface-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Groq transcription and Notetaker</h2>
            <p className="mt-1 max-w-2xl text-xs text-fg-muted">Import Groq keys from a local .env file. Mosaic encrypts them with Windows secure storage and uses them for audio transcription, Notetaker summaries, and topic discovery.</p>
            <p className="mt-2 text-xs text-fg-muted">{settings?.groqTranscriptionKeyCount ?? 0} Groq {settings?.groqTranscriptionKeyCount === 1 ? "key" : "keys"} stored</p>
          </div>
          <button type="button" disabled={Boolean(busy)} onClick={() => void run("transcription-keys", async () => {
            const result = await bridge()?.importGroqTranscriptionKeys();
            if (result) {
              setSettings(await bridge()?.getWorkspaceSettings() || null);
              setMessage(`Imported ${result.importedCount} Groq ${result.importedCount === 1 ? "key" : "keys"}.`);
            }
          })} className="inline-flex items-center gap-2 border border-line px-3 py-2 text-xs hover:bg-surface-hover "><FolderOpen size={14} /> Import .env keys</button>
        </div>
      </section>

      <section className="border border-line bg-surface-panel p-5">
        <h2 className="text-sm font-semibold">AI providers</h2>
        <p className="mt-1 text-xs text-fg-muted">Keys are encrypted by Windows and sent only to their named app provider. Groq powers transcription, Notetaker summaries, and topic discovery; desktop Ask Echo uses Codex CLI only.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {providers.map((provider) => <label key={provider.id} className="text-xs text-fg-muted">{provider.label} {settings?.apiKeys?.[provider.id] ? <span className="text-success-fg">· configured</span> : <span>· not configured</span>}<input type="password" value={apiKeys[provider.id] || ""} onChange={(event) => setApiKeys((current) => ({ ...current, [provider.id]: event.target.value }))} placeholder="Enter a new key" autoComplete="new-password" className="mt-1 w-full border border-line bg-surface-panel px-3 py-2 text-sm text-fg outline-none focus:border-focus" /></label>)}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">{providers.map((provider) => <button key={provider.id} type="button" disabled={Boolean(busy) || !apiKeys[provider.id]} onClick={() => void run(provider.id, async () => { const result = await bridge()?.saveApiKey(provider.id, apiKeys[provider.id]); setSettings(result || null); setApiKeys((current) => ({ ...current, [provider.id]: "" })); setMessage(`${provider.label} key saved.`); })} className="border border-line px-3 py-2 text-xs hover:bg-surface-hover ">Save {provider.label}</button>)}</div>
        <button type="button" onClick={() => void bridge()?.openCredentialManager()} className="mt-4 inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg"><ExternalLink size={13} /> Open Windows Credential Manager</button>
      </section>

      <section className="border border-line bg-surface-panel p-5">
        <h2 className="text-sm font-semibold">Codex CLI</h2>
        <p className="mt-1 text-xs text-fg-muted">{codex?.connected ? `Connected${codex.email ? ` as ${codex.email}` : ""}.` : codex?.available ? "Codex CLI is available but not signed in." : codex?.error || "Checking Codex CLI…"}</p>
        <p className="mt-2 break-all text-xs text-fg-muted">{codex?.workspaceDirectory || "No workspace folder selected."}</p>
        <button type="button" onClick={() => void run("codex", async () => { const result = await bridge()?.chooseCodexWorkspace(); if (result) setCodex(await bridge()?.getCodexStatus() || null); })} className="mt-3 inline-flex items-center gap-2 border border-line px-3 py-2 text-xs hover:bg-surface-hover"><FolderOpen size={14} /> Choose Codex workspace</button>
      </section>
    </div>
  </section>;
}
