import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "wouter";
import {
  File as FileIcon, Folder, Plus, Trash2,
  Save, Rocket, X, SendHorizontal,
  LayoutPanelLeft, Code2, Loader2, FolderOpen,
  FilePlus, FilePen, FileX, AlertCircle, Sparkles,
  Monitor, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sidebar } from "@/components/layout";
import {
  useGetProject,
  useListFiles,
  useGetFile,
  useCreateFile,
  useUpdateFile,
  useDeleteFile,
  useCreateDeployment,
  useAiChat,
  getListFilesQueryKey,
  getListDeploymentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ── Types ────────────────────────────────────────────────────────────────────

type ExecutedAction =
  | { type: "created";  filename: string; fileId: number }
  | { type: "edited";   filename: string; fileId: number }
  | { type: "deleted";  filename: string }
  | { type: "error";    filename: string; message: string };

type AiMessage = {
  role: "user" | "assistant";
  content: string;
  actions?: ExecutedAction[];
};

type MobileTab = "files" | "editor" | "ai" | "preview";

// ── Helpers ──────────────────────────────────────────────────────────────────

const LANG_MAP: Record<string, string> = {
  js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
  py: "python", rs: "rust", go: "go", html: "html", css: "css",
  json: "json", md: "markdown", yaml: "yaml", yml: "yaml", sh: "shell",
};

function getLanguage(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return LANG_MAP[ext] ?? "plaintext";
}

// ── ActionChip ───────────────────────────────────────────────────────────────

function ActionChips({ actions, onOpen }: { actions: ExecutedAction[]; onOpen: (fileId: number) => void }) {
  if (!actions.length) return null;
  return (
    <div className="mt-2 space-y-1">
      {actions.map((a, i) => {
        if (a.type === "created") return (
          <div key={i} className="flex items-center gap-1.5 text-[11px] bg-green-500/10 border border-green-500/25 rounded-md px-2 py-1">
            <FilePlus size={11} className="text-green-400 shrink-0" />
            <span className="text-green-300 font-mono truncate flex-1">{a.filename}</span>
            <button onClick={() => onOpen(a.fileId)} className="text-green-400 hover:text-green-200 shrink-0 underline">open</button>
          </div>
        );
        if (a.type === "edited") return (
          <div key={i} className="flex items-center gap-1.5 text-[11px] bg-blue-500/10 border border-blue-500/25 rounded-md px-2 py-1">
            <FilePen size={11} className="text-blue-400 shrink-0" />
            <span className="text-blue-300 font-mono truncate flex-1">{a.filename}</span>
            <button onClick={() => onOpen(a.fileId)} className="text-blue-400 hover:text-blue-200 shrink-0 underline">open</button>
          </div>
        );
        if (a.type === "deleted") return (
          <div key={i} className="flex items-center gap-1.5 text-[11px] bg-red-500/10 border border-red-500/25 rounded-md px-2 py-1">
            <FileX size={11} className="text-red-400 shrink-0" />
            <span className="text-red-300 font-mono truncate">{a.filename}</span>
          </div>
        );
        if (a.type === "error") return (
          <div key={i} className="flex items-center gap-1.5 text-[11px] bg-yellow-500/10 border border-yellow-500/25 rounded-md px-2 py-1">
            <AlertCircle size={11} className="text-yellow-400 shrink-0" />
            <span className="text-yellow-300 font-mono truncate">{a.filename}: {a.message}</span>
          </div>
        );
        return null;
      })}
    </div>
  );
}

// ── FileTree ─────────────────────────────────────────────────────────────────

function FileTree({
  files, selectedId, onSelect, onDelete,
}: {
  files: Array<{ id: number; name: string; path: string; type: string }>;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  if (!files.length) return <div className="p-4 text-xs text-muted-foreground">No files yet.</div>;
  return (
    <div className="space-y-0.5 p-2">
      {files.map((f) => (
        <div
          key={f.id}
          className={`group flex items-center gap-1.5 px-2 py-2 md:py-1.5 rounded cursor-pointer text-sm transition-colors ${
            selectedId === f.id
              ? "bg-primary/20 text-foreground"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          }`}
          onClick={() => onSelect(f.id)}
        >
          {f.type === "directory"
            ? <Folder size={13} className="shrink-0" />
            : <FileIcon size={13} className="shrink-0" />}
          <span className="flex-1 truncate font-mono text-xs">{f.name}</span>
          <button
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity p-0.5"
            onClick={(e) => { e.stopPropagation(); onDelete(f.id); }}
          >
            <Trash2 size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ── IDE Page ─────────────────────────────────────────────────────────────────

export default function IDE() {
  const params = useParams<{ id: string }>();
  const projectId = Number(params.id);
  const queryClient = useQueryClient();

  const { data: project } = useGetProject(projectId);
  const { data: files, isLoading: filesLoading } = useListFiles(projectId);

  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [editorContent, setEditorContent]   = useState("");
  const [isDirty, setIsDirty]               = useState(false);
  const [showAI, setShowAI]                 = useState(true);
  const [showPreview, setShowPreview]       = useState(false);
  const [previewKey, setPreviewKey]         = useState(0);
  const [showNewFile, setShowNewFile]       = useState(false);
  const [newFileName, setNewFileName]       = useState("");
  const [newFileType, setNewFileType]       = useState<"file" | "directory">("file");
  const [showDeploy, setShowDeploy]         = useState(false);
  const CHAT_KEY = `ide_chat_${projectId}`;
  const [aiMessages, setAiMessages]         = useState<AiMessage[]>(() => {
    try {
      const saved = localStorage.getItem(`ide_chat_${projectId}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [aiInput, setAiInput]               = useState("");
  const [mobileTab, setMobileTab]           = useState<MobileTab>("files");
  const chatEndRef                          = useRef<HTMLDivElement>(null);
  const [MonacoEditor, setMonacoEditor]     = useState<any>(null);

  const { data: selectedFile } = useGetFile(projectId, selectedFileId ?? 0, {
    query: { enabled: !!selectedFileId },
  });

  const updateFile       = useUpdateFile();
  const createFile       = useCreateFile();
  const deleteFile       = useDeleteFile();
  const createDeployment = useCreateDeployment();
  const aiChat           = useAiChat();

  // Lazy-load Monaco
  useEffect(() => {
    import("@monaco-editor/react").then((m) => setMonacoEditor(() => m.default));
  }, []);

  // Auto-select first file
  useEffect(() => {
    if (files && files.length > 0 && !selectedFileId) {
      const first = files.find(f => f.type === "file");
      if (first) setSelectedFileId(first.id);
    }
  }, [files]);

  // Sync editor when file changes
  useEffect(() => {
    if (selectedFile?.content !== undefined) {
      setEditorContent(selectedFile.content ?? "");
      setIsDirty(false);
    }
  }, [selectedFile?.id]);

  // Persist chat to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(aiMessages));
    } catch { /* storage full — ignore */ }
  }, [aiMessages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiMessages]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleSave() {
    if (!selectedFileId || !isDirty) return;
    updateFile.mutate(
      { id: projectId, fileId: selectedFileId, data: { content: editorContent } },
      { onSuccess: () => setIsDirty(false) }
    );
  }

  function handleCreateFile() {
    if (!newFileName.trim()) return;
    createFile.mutate({
      id: projectId,
      data: { name: newFileName.trim(), path: `/${newFileName.trim()}`, type: newFileType, content: "" },
    }, {
      onSuccess: (file) => {
        queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
        setSelectedFileId(file.id);
        setShowNewFile(false);
        setNewFileName("");
        setMobileTab("editor");
      },
    });
  }

  function handleDeleteFile(fileId: number) {
    deleteFile.mutate({ id: projectId, fileId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
        if (selectedFileId === fileId) { setSelectedFileId(null); setEditorContent(""); }
      },
    });
  }

  function handleDeploy() {
    createDeployment.mutate({ id: projectId, data: {} }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDeploymentsQueryKey(projectId) });
        setShowDeploy(false);
      },
    });
  }

  function openFileById(fileId: number) {
    setSelectedFileId(fileId);
    setMobileTab("editor");
  }

  function sendAiMessage(msg: string) {
    if (!msg.trim() || aiChat.isPending) return;
    setAiInput("");
    setAiMessages(prev => [...prev, { role: "user", content: msg }]);

    aiChat.mutate({
      id: projectId,
      data: {
        message: msg,
        context: selectedFile?.content ?? null,
        currentFile: selectedFile?.name ?? null,
      },
    }, {
      onSuccess: (data) => {
        const actions: ExecutedAction[] = (data as any).actions ?? [];
        if (actions.length > 0) {
          queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
        }
        const firstFileAction = actions.find(
          (a): a is Extract<ExecutedAction, { type: "created" | "edited" }> =>
            a.type === "created" || a.type === "edited"
        );
        if (firstFileAction) {
          setTimeout(() => {
            setSelectedFileId(firstFileAction.fileId);
            setMobileTab("editor");
          }, 300);
        }
        setAiMessages(prev => [...prev, {
          role: "assistant",
          content: data.reply,
          actions,
        }]);
      },
      onError: () => {
        setAiMessages(prev => [...prev, {
          role: "assistant",
          content: "Sorry, encountered an error. Please try again.",
        }]);
      },
    });
  }

  // Auto-trigger AI if user entered a build prompt on the new-project page
  useEffect(() => {
    const key = `ide_autostart_${projectId}`;
    const prompt = localStorage.getItem(key);
    if (prompt) {
      localStorage.removeItem(key);
      // Small delay so the IDE is fully mounted
      const timer = setTimeout(() => sendAiMessage(prompt), 800);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function handleAiSend() {
    if (!aiInput.trim() || aiChat.isPending) return;
    const msg = aiInput.trim();
    sendAiMessage(msg);
  }

  function selectFile(id: number) {
    setSelectedFileId(id);
    setMobileTab("editor");
  }

  const currentLang = selectedFile ? getLanguage(selectedFile.name) : "plaintext";

  // Refresh preview when AI creates/edits files
  useEffect(() => {
    setPreviewKey(k => k + 1);
  }, [files?.length]);

  // ── Panels ─────────────────────────────────────────────────────────────────

  const editorPanel = (
    <>
      {selectedFileId && selectedFile ? (
        <div className="flex flex-col h-full overflow-hidden">
          <div className="h-8 bg-card border-b border-border flex items-center px-3 gap-2 shrink-0">
            <FileIcon size={12} className="text-muted-foreground" />
            <span className="text-xs font-mono text-muted-foreground truncate">{selectedFile.name}</span>
            <span className="ml-auto text-xs text-muted-foreground font-mono hidden sm:block">{currentLang}</span>
          </div>
          <div className="flex-1 overflow-hidden">
            {MonacoEditor ? (
              <MonacoEditor
                height="100%"
                language={currentLang}
                value={editorContent}
                theme="vs-dark"
                onChange={(val: string | undefined) => { setEditorContent(val ?? ""); setIsDirty(true); }}
                options={{
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, monospace",
                  lineNumbers: "on",
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  automaticLayout: true,
                  tabSize: 2,
                  renderLineHighlight: "gutter",
                  padding: { top: 12, bottom: 12 },
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <Loader2 size={24} className="animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 h-full">
          <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
            <Code2 size={20} className="text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">No file selected</p>
            <p className="text-xs text-muted-foreground mt-0.5">Select a file or ask the AI to create one</p>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5"
            onClick={() => { setShowNewFile(true); setMobileTab("files"); }}>
            <Plus size={13} /> New File
          </Button>
        </div>
      )}
    </>
  );

  const aiPanel = (
    <div className="flex flex-col h-full overflow-hidden bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Sparkles size={12} className="text-primary" /> AI Agent
        </span>
        <div className="flex items-center gap-1">
          {aiMessages.length > 0 && (
            <button
              title="Clear chat"
              onClick={() => { setAiMessages([]); localStorage.removeItem(CHAT_KEY); }}
              className="text-xs text-muted-foreground hover:text-destructive px-1.5 py-0.5 rounded transition-colors"
            >
              Clear
            </button>
          )}
          <button onClick={() => setShowAI(false)} className="text-muted-foreground hover:text-foreground hidden md:block p-0.5">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto ide-scroll p-3 space-y-3">
        {aiMessages.length === 0 && (
          <div className="text-xs text-muted-foreground text-center pt-6 px-2 space-y-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
              <Sparkles size={18} className="text-primary" />
            </div>
            <p className="font-medium text-foreground">AI Coding Agent</p>
            <p className="opacity-70">I can create, edit, and delete files directly. Try:</p>
            <div className="space-y-1 text-left">
              {[
                "Create a weather app 7 day forecast",
                "Build a todo list app",
                "Make a calculator",
                "Edit this file to add dark mode",
                "Delete old.js",
              ].map(s => (
                <button
                  key={s}
                  onClick={() => setAiInput(s)}
                  className="w-full text-left px-2.5 py-1.5 rounded-md bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-border"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {aiMessages.map((msg, i) => (
          <div key={i} className={`text-xs ${msg.role === "user" ? "text-right" : ""}`}>
            <div className={`inline-block max-w-full text-left rounded-lg px-3 py-2 ${
              msg.role === "user"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground"
            }`}>
              <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
              {msg.actions && msg.actions.length > 0 && (
                <ActionChips actions={msg.actions} onOpen={openFileById} />
              )}
            </div>
          </div>
        ))}

        {aiChat.isPending && (
          <div className="text-xs">
            <div className="inline-flex items-center gap-2 bg-muted rounded-lg px-3 py-2 text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              <span>Working…</span>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="p-2 border-t border-border shrink-0">
        <div className="flex gap-1.5">
          <Input
            className="text-xs h-9 bg-background"
            placeholder="Create, edit, delete files…"
            value={aiInput}
            onChange={(e) => setAiInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAiSend(); } }}
          />
          <Button
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={handleAiSend}
            disabled={aiChat.isPending || !aiInput.trim()}
          >
            <SendHorizontal size={13} />
          </Button>
        </div>
      </div>
    </div>
  );

  const previewPanel = (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Monitor size={12} className="text-primary" /> Preview
        </span>
        <div className="flex items-center gap-1">
          <button
            title="Refresh preview"
            onClick={() => setPreviewKey(k => k + 1)}
            className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
          >
            <RefreshCw size={12} />
          </button>
          <button
            title="Open in new tab"
            onClick={() => window.open(`/api/projects/${projectId}/preview`, "_blank")}
            className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors hidden md:block"
          >
            <X size={12} className="rotate-45" />
          </button>
          <button
            onClick={() => setShowPreview(false)}
            className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors hidden md:block"
          >
            <X size={12} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden bg-white">
        <iframe
          key={previewKey}
          src={`/api/projects/${projectId}/preview`}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
          title="Project Preview"
        />
      </div>
    </div>
  );

  const fileTreePanel = (
    <div className="flex flex-col h-full bg-sidebar overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-sidebar-border shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Files</span>
        <button className="text-muted-foreground hover:text-foreground" onClick={() => setShowNewFile(true)}>
          <Plus size={14} />
        </button>
      </div>
      {filesLoading ? (
        <div className="p-3 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-6 rounded" />)}</div>
      ) : (
        <div className="flex-1 overflow-auto ide-scroll">
          <FileTree files={files ?? []} selectedId={selectedFileId} onSelect={selectFile} onDelete={handleDeleteFile} />
        </div>
      )}
    </div>
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden md:flex flex-col w-16 lg:w-auto shrink-0 h-full">
        <Sidebar />
      </div>

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top bar */}
        <div className="h-11 border-b border-border bg-card flex items-center gap-2 px-3 shrink-0">
          <Link href="/projects">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground gap-1">
              <LayoutPanelLeft size={12} />
              <span className="hidden sm:inline">Projects</span>
            </Button>
          </Link>
          <span className="text-muted-foreground text-xs hidden sm:inline">/</span>
          <span className="text-sm font-medium truncate max-w-[120px] sm:max-w-none">{project?.name ?? "Loading…"}</span>
          {isDirty && <Badge variant="secondary" className="text-xs h-5 px-1.5 shrink-0">unsaved</Badge>}
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={handleSave} disabled={!isDirty || updateFile.isPending}>
              {updateFile.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              <span className="hidden sm:inline">Save</span>
            </Button>
            <Button
              variant="ghost" size="sm"
              className={`h-7 px-2 text-xs gap-1 hidden md:flex ${showPreview ? "bg-primary/10 text-primary" : ""}`}
              onClick={() => setShowPreview(!showPreview)}
            >
              <Monitor size={12} className={showPreview ? "text-primary" : ""} />
              Preview
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 hidden md:flex" onClick={() => setShowAI(!showAI)}>
              <Sparkles size={12} className="text-primary" />
              AI
            </Button>
            <Button size="sm" className="h-7 px-2 sm:px-3 text-xs gap-1" onClick={() => setShowDeploy(true)}>
              <Rocket size={12} />
              <span className="hidden sm:inline">Deploy</span>
            </Button>
          </div>
        </div>

        {/* Desktop layout */}
        <div className="hidden md:flex flex-1 min-h-0 overflow-hidden">
          <div className="w-52 border-r border-border shrink-0">{fileTreePanel}</div>
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">{editorPanel}</div>
          {showPreview && <div className="w-96 border-l border-border shrink-0">{previewPanel}</div>}
          {showAI && <div className="w-80 border-l border-border shrink-0">{aiPanel}</div>}
        </div>

        {/* Mobile tabbed layout */}
        <div className="flex md:hidden flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex border-b border-border bg-card shrink-0">
            {([
              { key: "files",   label: "Files",   icon: FolderOpen },
              { key: "editor",  label: "Editor",  icon: Code2 },
              { key: "preview", label: "Preview", icon: Monitor },
              { key: "ai",      label: "AI",      icon: Sparkles },
            ] as const).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => { setMobileTab(key); if (key === "preview") setPreviewKey(k => k + 1); }}
                className={`flex-1 flex items-center justify-center gap-1 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                  mobileTab === key
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground"
                }`}
              >
                <Icon size={12} className={(key === "ai" || key === "preview") && mobileTab !== key ? "text-primary" : ""} />
                <span className="hidden xs:inline">{label}</span>
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {mobileTab === "files"   && fileTreePanel}
            {mobileTab === "editor"  && <div className="h-full overflow-hidden">{editorPanel}</div>}
            {mobileTab === "preview" && <div className="h-full overflow-hidden">{previewPanel}</div>}
            {mobileTab === "ai"      && aiPanel}
          </div>
        </div>
      </div>

      {/* New file dialog */}
      <Dialog open={showNewFile} onOpenChange={setShowNewFile}>
        <DialogContent>
          <DialogHeader><DialogTitle>New File</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Type</label>
              <Select value={newFileType} onValueChange={(v: "file" | "directory") => setNewFileType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="file">File</SelectItem>
                  <SelectItem value="directory">Directory</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input
                className="font-mono"
                placeholder="index.ts"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateFile(); }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewFile(false)}>Cancel</Button>
            <Button onClick={handleCreateFile} disabled={!newFileName.trim() || createFile.isPending}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deploy dialog */}
      <Dialog open={showDeploy} onOpenChange={setShowDeploy}>
        <DialogContent>
          <DialogHeader><DialogTitle>Deploy Project</DialogTitle></DialogHeader>
          <div className="py-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Deploy <strong>{project?.name}</strong> to a live URL. Your project will be built and hosted instantly.
            </p>
            <div className="bg-muted/30 rounded-lg p-4 text-sm space-y-1">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Region</span><span>us-east-1</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Domain</span><span className="font-mono">auto-assigned</span></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeploy(false)}>Cancel</Button>
            <Button onClick={handleDeploy} disabled={createDeployment.isPending} className="gap-2">
              {createDeployment.isPending ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
              {createDeployment.isPending ? "Deploying…" : "Deploy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
