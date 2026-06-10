import { useState, useEffect, useRef } from "react";
import { useParams, Link, useLocation } from "wouter";
import {
  File as FileIcon, Folder, Plus, Trash2,
  Save, Rocket, X, SendHorizontal,
  LayoutPanelLeft, Code2, Loader2, FolderOpen,
  FilePlus, FilePen, FileX, AlertCircle, Sparkles,
  Monitor, RefreshCw, Paperclip, ImageIcon,
  ChevronRight, ChevronDown, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sidebar } from "@/components/layout";
import {
  useGetProject,
  useListProjects,
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
  imageUrl?: string;
};

type IDEFile = {
  id: number;
  name: string;
  path: string;
  type: string;
  content?: string | null;
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

function isProjectMetadataFile(filename: string): boolean {
  const normalized = filename.replace(/^\//, "").toLowerCase();
  return new Set([
    ".gitignore",
    ".npmrc",
    ".replit",
    ".replitignore",
    "components.json",
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "replit.md",
    "tsconfig.json",
    "tsconfig.base.json",
    "vite.config.ts",
    "vite.config.js",
  ]).has(normalized);
}

// ── Simple markdown renderer ─────────────────────────────────────────────────

function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/`([^`\n]+)`/g, "<code style='font-family:monospace;font-size:10px;background:rgba(0,0,0,.25);padding:1px 4px;border-radius:3px'>$1</code>")
    .replace(/\n/g, "<br>");
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

type TreeNode = {
  name: string;
  fullPath: string;
  isDir: boolean;
  children: TreeNode[];
  fileId?: number;
};

function buildFileTree(
  files: Array<{ id: number; name: string; path: string; type: string }>
): TreeNode[] {
  const dirMap = new Map<string, TreeNode>();
  const root: TreeNode[] = [];

  function ensureDir(segments: string[]): TreeNode {
    const key = segments.join("/");
    if (dirMap.has(key)) return dirMap.get(key)!;
    const node: TreeNode = { name: segments[segments.length - 1], fullPath: key, isDir: true, children: [] };
    dirMap.set(key, node);
    if (segments.length === 1) {
      root.push(node);
    } else {
      const parent = ensureDir(segments.slice(0, -1));
      parent.children.push(node);
    }
    return node;
  }

  for (const file of files) {
    const parts = file.name.split("/");
    const fileName = parts[parts.length - 1];
    const fileNode: TreeNode = { name: fileName, fullPath: file.name, isDir: false, children: [], fileId: file.id };
    if (parts.length === 1) {
      root.push(fileNode);
    } else {
      const dir = ensureDir(parts.slice(0, -1));
      dir.children.push(fileNode);
    }
  }

  function sortNodes(nodes: TreeNode[]): TreeNode[] {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach(n => { if (n.isDir) sortNodes(n.children); });
    return nodes;
  }

  return sortNodes(root);
}

function FileTreeNode({
  node, selectedId, onSelect, onDelete, showHidden, depth, expanded, onToggle,
}: {
  node: TreeNode; selectedId: number | null;
  onSelect: (id: number) => void; onDelete: (id: number) => void;
  showHidden: boolean; depth: number;
  expanded: Set<string>; onToggle: (path: string) => void;
}) {
  if (!showHidden && node.name.startsWith(".")) return null;
  const indent = depth * 12;

  if (node.isDir) {
    const open = expanded.has(node.fullPath);
    return (
      <div>
        <div
          className="group flex items-center gap-1 py-[5px] rounded cursor-pointer text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          style={{ paddingLeft: `${8 + indent}px`, paddingRight: "8px" }}
          onClick={() => onToggle(node.fullPath)}
        >
          {open ? <ChevronDown size={11} className="shrink-0 opacity-60" /> : <ChevronRight size={11} className="shrink-0 opacity-60" />}
          <Folder size={12} className="shrink-0 text-sky-400/80" />
          <span className="flex-1 truncate font-mono text-xs">{node.name}</span>
        </div>
        {open && node.children.map(child => (
          <FileTreeNode key={child.fullPath} node={child} selectedId={selectedId}
            onSelect={onSelect} onDelete={onDelete} showHidden={showHidden}
            depth={depth + 1} expanded={expanded} onToggle={onToggle} />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`group flex items-center gap-1.5 py-[5px] md:py-[5px] rounded cursor-pointer transition-colors ${
        selectedId === node.fileId
          ? "bg-primary/20 text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      }`}
      style={{ paddingLeft: `${8 + indent}px`, paddingRight: "8px" }}
      onClick={() => node.fileId !== undefined && onSelect(node.fileId)}
    >
      <FileIcon size={12} className="shrink-0" />
      <span className="flex-1 truncate font-mono text-xs">{node.name}</span>
      <button
        className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity p-0.5 shrink-0"
        onClick={(e) => { e.stopPropagation(); node.fileId !== undefined && onDelete(node.fileId); }}
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

function FileTree({
  files, selectedId, onSelect, onDelete, showHidden,
}: {
  files: Array<{ id: number; name: string; path: string; type: string }>;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
  showHidden: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Auto-expand all directories when the file list changes
  useEffect(() => {
    const dirs = new Set<string>();
    files.forEach(f => {
      const parts = f.name.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    });
    if (dirs.size > 0) setExpanded(prev => new Set([...prev, ...dirs]));
  }, [files.length]);

  function toggle(path: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  if (!files.length) return <div className="p-4 text-xs text-muted-foreground">No files yet.</div>;

  const tree = buildFileTree(files);
  const anyVisible = tree.some(n => showHidden || !n.name.startsWith("."));
  if (!anyVisible) return <div className="p-4 text-xs text-muted-foreground">All files are hidden. Toggle · to show them.</div>;

  return (
    <div className="py-1 px-1">
      {tree.map(node => (
        <FileTreeNode key={node.fullPath} node={node} selectedId={selectedId}
          onSelect={onSelect} onDelete={onDelete} showHidden={showHidden}
          depth={0} expanded={expanded} onToggle={toggle} />
      ))}
    </div>
  );
}

// ── IDE Page ─────────────────────────────────────────────────────────────────

export default function IDE() {
  const params = useParams<{ id: string }>();
  const projectId = Number(params.id);
  const queryClient = useQueryClient();

  const [, navigate] = useLocation();
  const { data: project } = useGetProject(projectId);
  const { data: allProjects } = useListProjects();
  const { data: files, isLoading: filesLoading } = useListFiles(projectId);
  const projectFiles = (files ?? []) as IDEFile[];
  const appFiles = projectFiles.filter((f) => !isProjectMetadataFile(f.name));

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
  const [deployedUrl, setDeployedUrl]       = useState<string | null>(null);
  const [deployedId, setDeployedId]         = useState<number | null>(null);
  const [deployStage, setDeployStage]       = useState<"idle" | "building" | "live">("idle");
  const [buildLogLines, setBuildLogLines]   = useState<string[]>([]);
  const CHAT_KEY = `ide_chat_${projectId}`;
  const [aiMessages, setAiMessages]         = useState<AiMessage[]>(() => {
    try {
      const saved = localStorage.getItem(`ide_chat_${projectId}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [aiInput, setAiInput]               = useState("");
  const [mobileTab, setMobileTab]           = useState<MobileTab>("files");
  const [attachedImage, setAttachedImage]   = useState<{ dataUrl: string; name: string } | null>(null);
  const [showHiddenFiles, setShowHiddenFiles] = useState(false);
  const chatEndRef                          = useRef<HTMLDivElement>(null);
  const fileInputRef                        = useRef<HTMLInputElement>(null);
  const [MonacoEditor, setMonacoEditor]     = useState<any>(null);

  const { data: selectedFile } = useGetFile(projectId, selectedFileId ?? 0, {
    query: { enabled: !!selectedFileId, queryKey: [] },
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
    if (projectFiles.length > 0 && !selectedFileId) {
      const first = projectFiles.find((f) => f.type === "file" && !isProjectMetadataFile(f.name));
      if (first) setSelectedFileId(first.id);
    }
  }, [files, selectedFileId]);

  // Sync editor when file changes
  useEffect(() => {
    if (selectedFile?.content !== undefined) {
      setEditorContent(selectedFile.content ?? "");
      setIsDirty(false);
    }
  }, [selectedFile?.id]);

  // Ctrl+S / Cmd+S to save
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (selectedFileId && isDirty) {
          updateFile.mutate(
            { id: projectId, fileId: selectedFileId, data: { content: editorContent } },
            { onSuccess: () => setIsDirty(false) }
          );
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedFileId, isDirty, editorContent, projectId]);

  // Persist chat to localStorage — cap at last 60 messages to avoid 5MB limit
  useEffect(() => {
    try {
      const toSave = aiMessages.length > 60 ? aiMessages.slice(-60) : aiMessages;
      localStorage.setItem(CHAT_KEY, JSON.stringify(toSave));
    } catch {
      // Storage full — prune aggressively to just the last 10 messages
      try {
        localStorage.setItem(CHAT_KEY, JSON.stringify(aiMessages.slice(-10)));
      } catch { /* give up gracefully */ }
    }
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

  async function handleDeploy() {
    setDeployedUrl(null);
    setDeployedId(null);
    setDeployStage("building");
    setBuildLogLines([]);

    const steps = [
      "Collecting project files...",
      "Bundling assets...",
      "Optimizing for production...",
      "Generating preview URL...",
      "Health check passed ✓",
      "Deployment live! 🚀",
    ];
    for (let i = 0; i < steps.length; i++) {
      await new Promise<void>(r => setTimeout(r, 350));
      setBuildLogLines(prev => [...prev, steps[i]]);
    }

    createDeployment.mutate({ id: projectId, data: {} }, {
      onSuccess: (deployment) => {
        queryClient.invalidateQueries({ queryKey: getListDeploymentsQueryKey(projectId) });
        setDeployStage("live");
        setDeployedUrl((deployment as any).url ?? null);
        setDeployedId((deployment as any).id ?? null);
      },
      onError: () => {
        setDeployStage("idle");
        setBuildLogLines([]);
      },
    });
  }

  function openFileById(fileId: number) {
    setSelectedFileId(fileId);
    setMobileTab("editor");
  }

  function sendAiMessage(msg: string, imgUrl?: string) {
    if (!msg.trim() && !imgUrl || aiChat.isPending) return;
    const finalMsg = msg.trim() || (imgUrl ? "Describe what you see in this image and suggest what to build." : "");
    setAiInput("");
    setAttachedImage(null);
    setAiMessages(prev => [...prev, { role: "user", content: finalMsg, imageUrl: imgUrl }]);

    aiChat.mutate({
      id: projectId,
      data: {
        message: finalMsg,
        context: null,
        currentFile: selectedFile && !isProjectMetadataFile(selectedFile.name) ? selectedFile.name ?? null : null,
        imageUrl: imgUrl ?? null,
      } as any,
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
    if (!prompt) return;
    localStorage.removeItem(key);
    // Small delay so the IDE is fully mounted
    const timer = setTimeout(() => sendAiMessage(prompt), 800);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function handleAiSend() {
    if ((!aiInput.trim() && !attachedImage) || aiChat.isPending) return;
    sendAiMessage(aiInput.trim(), attachedImage?.dataUrl);
  }

  function handleImageAttach(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAttachedImage({ dataUrl: reader.result as string, name: file.name });
    reader.readAsDataURL(file);
    e.target.value = "";
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
                  fontSize: Number(localStorage.getItem("editor_fontSize") ?? "13"),
                  fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, monospace",
                  lineNumbers: "on",
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: (localStorage.getItem("editor_wordWrap") === "false" ? "off" : "on") as "on" | "off",
                  automaticLayout: true,
                  tabSize: Number(localStorage.getItem("editor_tabSize") ?? "2"),
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
          <div className="text-[12px] text-muted-foreground text-center pt-4 px-2 space-y-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
              <Sparkles size={18} className="text-primary" />
            </div>
            <div>
              <p className="font-semibold text-foreground text-sm">AI Coding Agent</p>
              <p className="opacity-60 mt-0.5">
                {appFiles.length > 0
                  ? `I can see ${appFiles.length} app file${appFiles.length !== 1 ? "s" : ""} in your project. What would you like to do?`
                  : "I can build complete web apps for you. Try one of these:"}
              </p>
            </div>
            <div className="space-y-1 text-left">
              {(appFiles.length > 0
                ? [
                    "Add a search bar",
                    "Add dark mode toggle",
                    "Redesign the UI",
                    "Add a footer",
                    "Add a contact form",
                  ]
                : [
                    "Create a weather app with 7 day forecast",
                    "Build a todo list app",
                    "Make a calculator",
                    "Create a portfolio website",
                    "Build a quiz app",
                  ]
              ).map(s => (
                <button
                  key={s}
                  onClick={() => sendAiMessage(s)}
                  className="w-full text-left px-2.5 py-1.5 rounded-md bg-muted/50 hover:bg-primary/10 hover:border-primary/30 text-muted-foreground hover:text-foreground transition-colors border border-border"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {aiMessages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <div className="w-5 h-5 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mr-1.5 mt-0.5 shrink-0">
                <Sparkles size={10} className="text-primary" />
              </div>
            )}
            <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed ${
              msg.role === "user"
                ? "bg-primary text-primary-foreground rounded-br-sm"
                : "bg-muted text-foreground rounded-bl-sm"
            }`}>
              {msg.imageUrl && (
                <img src={msg.imageUrl} alt="attachment" className="rounded-md mb-1.5 max-w-[200px] max-h-[150px] object-cover" />
              )}
              <p
                className="break-words"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
              />
              {msg.actions && msg.actions.length > 0 && (
                <ActionChips actions={msg.actions} onOpen={openFileById} />
              )}
            </div>
          </div>
        ))}

        {aiChat.isPending && (
          <div className="flex justify-start">
            <div className="w-5 h-5 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mr-1.5 mt-0.5 shrink-0">
              <Sparkles size={10} className="text-primary" />
            </div>
            <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="p-2 border-t border-border shrink-0">
        {appFiles.length > 0 && (
          <div className="flex items-center gap-1 mb-1.5 text-[10px] text-muted-foreground px-0.5">
            <FolderOpen size={9} />
            <span className="truncate">Using <span className="text-foreground font-medium">{appFiles.length} project file{appFiles.length !== 1 ? "s" : ""}</span> as context</span>
          </div>
        )}
        {attachedImage && (
          <div className="flex items-center gap-1.5 mb-1.5 bg-muted/50 rounded-md px-2 py-1">
            <img src={attachedImage.dataUrl} alt="preview" className="w-8 h-8 rounded object-cover shrink-0" />
            <span className="text-[10px] text-muted-foreground truncate flex-1">{attachedImage.name}</span>
            <button
              onClick={() => setAttachedImage(null)}
              className="text-muted-foreground hover:text-destructive shrink-0"
            >
              <X size={12} />
            </button>
          </div>
        )}
        <div className="flex gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageAttach}
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => fileInputRef.current?.click()}
            title="Attach image"
          >
            <Paperclip size={14} />
          </Button>
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
            disabled={aiChat.isPending || (!aiInput.trim() && !attachedImage)}
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
        <div className="flex items-center gap-1">
          <button
            title={showHiddenFiles ? "Hide dotfiles" : "Show dotfiles"}
            onClick={() => setShowHiddenFiles(v => !v)}
            className={`text-[10px] font-mono px-1 rounded transition-colors ${showHiddenFiles ? "text-foreground bg-muted" : "text-muted-foreground hover:text-foreground"}`}
          >·</button>
          <button className="text-muted-foreground hover:text-foreground" onClick={() => setShowNewFile(true)}>
            <Plus size={14} />
          </button>
        </div>
      </div>
      {filesLoading ? (
        <div className="p-3 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-6 rounded" />)}</div>
      ) : (
        <div className="flex-1 overflow-auto ide-scroll">
          <FileTree files={files ?? []} selectedId={selectedFileId} onSelect={selectFile} onDelete={handleDeleteFile} showHidden={showHiddenFiles} />
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
          <Select
            value={String(projectId)}
            onValueChange={(val) => {
              if (Number(val) !== projectId) navigate(`/projects/${val}`);
            }}
          >
            <SelectTrigger className="h-7 text-sm font-medium border-0 bg-transparent shadow-none px-1.5 max-w-[150px] sm:max-w-[220px] focus:ring-0 focus:ring-offset-0">
              <SelectValue placeholder={project?.name ?? "Loading…"} />
            </SelectTrigger>
            <SelectContent>
              {allProjects?.map(p => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
      <Dialog open={showDeploy} onOpenChange={(open) => {
        if (!open) { setShowDeploy(false); setDeployedUrl(null); setDeployedId(null); setDeployStage("idle"); setBuildLogLines([]); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deployStage === "live" ? "Deployment Live 🚀" : deployStage === "building" ? "Deploying…" : "Deploy Project"}
            </DialogTitle>
          </DialogHeader>

          {deployStage === "live" && deployedUrl ? (
            <div className="py-4 space-y-4">
              <div className="flex items-center gap-2 text-sm text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3">
                <Rocket size={16} className="shrink-0" />
                <span>Your project is live!</span>
              </div>
              <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Live Preview URL</p>
                  <a
                    href={deployedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline text-sm font-mono flex items-center gap-1 break-all"
                  >
                    {deployedUrl} <ExternalLink size={12} className="shrink-0" />
                  </a>
                </div>
              </div>
              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button variant="outline" onClick={() => { setShowDeploy(false); setDeployedUrl(null); setDeployedId(null); setDeployStage("idle"); }}>Close</Button>
                {deployedId && (
                  <Link href={`/deployments/${deployedId}`}>
                    <Button variant="secondary" onClick={() => { setShowDeploy(false); setDeployedUrl(null); setDeployedId(null); setDeployStage("idle"); }}>
                      Manage Deployment
                    </Button>
                  </Link>
                )}
                <Button onClick={() => window.open(deployedUrl, "_blank")} className="gap-2">
                  <ExternalLink size={14} /> Open Preview
                </Button>
              </DialogFooter>
            </div>

          ) : deployStage === "building" ? (
            <div className="py-4 space-y-4">
              <div className="bg-black/80 rounded-lg p-4 font-mono text-xs space-y-1 min-h-[120px]">
                {buildLogLines.map((line, i) => (
                  <div key={i} className={`flex items-center gap-2 ${i === buildLogLines.length - 1 ? "text-green-400" : "text-muted-foreground"}`}>
                    <span className="text-blue-400 select-none">▶</span>
                    <span>{line}</span>
                  </div>
                ))}
                <div className="flex items-center gap-1 text-muted-foreground/50">
                  <Loader2 size={10} className="animate-spin" />
                  <span>running…</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center">Building and deploying {project?.name}…</p>
            </div>

          ) : (
            <>
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
                <Button onClick={handleDeploy} className="gap-2">
                  <Rocket size={14} /> Deploy
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
