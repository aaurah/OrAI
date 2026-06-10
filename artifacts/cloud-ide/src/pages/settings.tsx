import { useState, useEffect } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Github, Eye, EyeOff, CheckCircle2, XCircle, Loader2,
  Palette, Code2, KeyRound, User, Moon, Sun, Monitor,
  Save, Trash2, ExternalLink,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border bg-muted/20">
        <Icon size={16} className="text-muted-foreground" />
        <h2 className="font-semibold text-sm">{title}</h2>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  );
}

function Row({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ── Theme toggle ───────────────────────────────────────────────────────────────

function useTheme() {
  const [theme, setThemeState] = useState<"light" | "dark" | "system">(() => {
    return (localStorage.getItem("theme") as any) ?? "system";
  });

  function setTheme(t: "light" | "dark" | "system") {
    setThemeState(t);
    localStorage.setItem("theme", t);
    const root = document.documentElement;
    if (t === "dark") {
      root.classList.add("dark");
    } else if (t === "light") {
      root.classList.remove("dark");
    } else {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.classList.toggle("dark", prefersDark);
    }
  }

  return { theme, setTheme };
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Settings() {
  const { toast } = useToast();

  // ── GitHub token ────────────────────────────────────────────────────────────
  const [token, setToken] = useState(sessionStorage.getItem("github_token") ?? "");
  const [tokenInput, setTokenInput] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [ghUser, setGhUser] = useState<{ login: string; name: string; avatar_url: string } | null>(null);
  const [ghChecked, setGhChecked] = useState(false);

  useEffect(() => {
    if (token) verifyToken(token, false);
  }, []);

  async function verifyToken(t: string, showToast = true) {
    setVerifying(true);
    try {
      const res = await fetch("/api/github/user", {
        headers: { "x-github-token": t, "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data?.login) {
        setGhUser(data);
        setToken(t);
        sessionStorage.setItem("github_token", t);
        setGhChecked(true);
        if (showToast) toast({ title: `Connected as @${data.login}` });
      } else {
        setGhUser(null);
        setGhChecked(true);
        if (showToast) toast({ title: "Invalid token or insufficient permissions", variant: "destructive" });
      }
    } catch {
      setGhUser(null);
      setGhChecked(true);
      if (showToast) toast({ title: "Could not reach GitHub", variant: "destructive" });
    } finally {
      setVerifying(false);
    }
  }

  function saveToken() {
    const t = tokenInput.trim();
    if (!t) return;
    verifyToken(t);
    setTokenInput("");
  }

  function disconnectGitHub() {
    sessionStorage.removeItem("github_token");
    setToken("");
    setGhUser(null);
    setGhChecked(false);
    toast({ title: "GitHub disconnected" });
  }

  // ── Appearance ──────────────────────────────────────────────────────────────
  const { theme, setTheme } = useTheme();

  // ── Editor preferences ──────────────────────────────────────────────────────
  const [fontSize, setFontSize] = useState(() => localStorage.getItem("editor_fontSize") ?? "14");
  const [tabSize, setTabSize] = useState(() => localStorage.getItem("editor_tabSize") ?? "2");
  const [wordWrap, setWordWrap] = useState(() => localStorage.getItem("editor_wordWrap") !== "false");

  function saveEditorPrefs() {
    localStorage.setItem("editor_fontSize", fontSize);
    localStorage.setItem("editor_tabSize", tabSize);
    localStorage.setItem("editor_wordWrap", String(wordWrap));
    toast({ title: "Editor preferences saved" });
  }

  // ── OpenAI key ──────────────────────────────────────────────────────────────
  const [aiKey, setAiKey] = useState(sessionStorage.getItem("openai_key") ?? "");
  const [showAiKey, setShowAiKey] = useState(false);

  function saveAiKey() {
    if (aiKey.trim()) {
      sessionStorage.setItem("openai_key", aiKey.trim());
    } else {
      sessionStorage.removeItem("openai_key");
    }
    toast({ title: "AI key saved" });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Layout>
      <div className="p-4 sm:p-8 max-w-2xl mx-auto w-full space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-1">Settings</h1>
          <p className="text-muted-foreground text-sm">Manage your account and workspace preferences.</p>
        </div>

        {/* GitHub */}
        <Section title="GitHub" icon={Github}>
          {ghUser ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <CheckCircle2 size={16} className="text-green-400 shrink-0" />
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <img src={ghUser.avatar_url} className="w-7 h-7 rounded-full" alt="" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{ghUser.name || ghUser.login}</p>
                    <p className="text-xs text-muted-foreground">@{ghUser.login}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a href="https://github.com/settings/tokens" target="_blank" rel="noopener">
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5">
                      <ExternalLink size={11} />Tokens
                    </Button>
                  </a>
                  <Button size="sm" variant="destructive" onClick={disconnectGitHub} className="h-7 text-xs gap-1.5">
                    <XCircle size={11} />Disconnect
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Replace token</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showToken ? "text" : "password"}
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                      value={tokenInput}
                      onChange={e => setTokenInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && saveToken()}
                      className="font-mono text-sm pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(s => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <Button onClick={saveToken} disabled={verifying || !tokenInput.trim()} className="gap-1.5 text-sm">
                    {verifying ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    Save
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {ghChecked && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                  <XCircle size={14} className="shrink-0" />
                  No GitHub account connected.
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Personal Access Token</label>
                <p className="text-xs text-muted-foreground">
                  Requires <code className="bg-muted px-1 rounded text-[11px]">repo</code>,{" "}
                  <code className="bg-muted px-1 rounded text-[11px]">read:user</code>,{" "}
                  <code className="bg-muted px-1 rounded text-[11px]">notifications</code> scopes.
                </p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showToken ? "text" : "password"}
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                      value={tokenInput}
                      onChange={e => setTokenInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && saveToken()}
                      className="font-mono text-sm pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(s => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <Button onClick={saveToken} disabled={verifying || !tokenInput.trim()} className="gap-1.5 text-sm">
                    {verifying ? <Loader2 size={14} className="animate-spin" /> : <Github size={14} />}
                    Connect
                  </Button>
                </div>
                <a
                  href="https://github.com/settings/tokens/new?scopes=repo,read:user,notifications,gist&description=CloudIDE"
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  Generate token on GitHub <ExternalLink size={10} />
                </a>
              </div>
            </div>
          )}
        </Section>

        {/* Appearance */}
        <Section title="Appearance" icon={Palette}>
          <Row label="Theme" description="Controls the color scheme of the IDE">
            <div className="flex rounded-lg border border-border overflow-hidden">
              {(["light", "system", "dark"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs capitalize transition-colors ${
                    theme === t
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  {t === "light" && <Sun size={12} />}
                  {t === "system" && <Monitor size={12} />}
                  {t === "dark" && <Moon size={12} />}
                  {t}
                </button>
              ))}
            </div>
          </Row>
        </Section>

        {/* Editor */}
        <Section title="Editor" icon={Code2}>
          <Row label="Font size" description="Code editor font size in pixels">
            <div className="flex rounded-lg border border-border overflow-hidden">
              {["12", "13", "14", "16", "18"].map((s) => (
                <button
                  key={s}
                  onClick={() => setFontSize(s)}
                  className={`px-3 py-1.5 text-xs transition-colors ${
                    fontSize === s
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Tab size" description="Number of spaces per indentation level">
            <div className="flex rounded-lg border border-border overflow-hidden">
              {["2", "4"].map((s) => (
                <button
                  key={s}
                  onClick={() => setTabSize(s)}
                  className={`px-4 py-1.5 text-xs transition-colors ${
                    tabSize === s
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  {s} spaces
                </button>
              ))}
            </div>
          </Row>
          <Row label="Word wrap" description="Wrap long lines in the editor">
            <button
              onClick={() => setWordWrap(w => !w)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                wordWrap ? "bg-primary" : "bg-muted"
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                wordWrap ? "translate-x-4" : "translate-x-0.5"
              }`} />
            </button>
          </Row>
          <div className="pt-1">
            <Button size="sm" onClick={saveEditorPrefs} className="gap-1.5 text-sm">
              <Save size={13} />Save Editor Preferences
            </Button>
          </div>
        </Section>

        {/* AI / API Key */}
        <Section title="AI Assistant" icon={KeyRound}>
          <div className="space-y-3">
            <Row label="OpenAI API Key" description="Override the server's key with your own (optional)">
              <Badge variant={aiKey ? "default" : "secondary"} className="text-xs">
                {aiKey ? "Custom key set" : "Using server key"}
              </Badge>
            </Row>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showAiKey ? "text" : "password"}
                  placeholder="sk-..."
                  value={aiKey}
                  onChange={e => setAiKey(e.target.value)}
                  className="font-mono text-sm pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowAiKey(s => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showAiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <Button onClick={saveAiKey} className="gap-1.5 text-sm">
                <Save size={14} />Save
              </Button>
              {aiKey && (
                <Button variant="outline" onClick={() => { setAiKey(""); sessionStorage.removeItem("openai_key"); toast({ title: "Key cleared" }); }} className="gap-1.5 text-sm">
                  <Trash2 size={14} />Clear
                </Button>
              )}
            </div>
          </div>
        </Section>

        {/* Account */}
        <Section title="Account" icon={User}>
          <Row label="Data storage" description="All project data is stored server-side in PostgreSQL">
            <Badge variant="outline" className="text-xs">PostgreSQL</Badge>
          </Row>
          <Row label="Version" description="CloudIDE application version">
            <Badge variant="secondary" className="text-xs font-mono">0.1.0</Badge>
          </Row>
          <div className="pt-1 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Editor and theme preferences are stored in localStorage. API tokens are kept in sessionStorage and cleared when this browser session ends.
            </p>
          </div>
        </Section>
      </div>
    </Layout>
  );
}
