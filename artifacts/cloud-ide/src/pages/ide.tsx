import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "wouter";
import {
  ChevronRight, ChevronDown, File as FileIcon, Folder, Plus, Trash2,
  Save, Rocket, Eye, MessageSquare, X, SendHorizontal, Terminal,
  LayoutPanelLeft, Code2, Loader2
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
  getGetProjectQueryKey,
  getListDeploymentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type AiMessage = { role: "user" | "assistant"; content: string; codeBlocks?: Array<{ language: string; code: string; filename: string | null }> };

const LANG_MAP: Record<string, string> = {
  js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
  py: "python", rs: "rust", go: "go", html: "html", css: "css",
  json: "json", md: "markdown", yaml: "yaml", yml: "yaml", sh: "shell",
};

function getLanguage(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return LANG_MAP[ext] ?? "plaintext";
}

function FileTree({
  files,
  selectedId,
  onSelect,
  onDelete,
}: {
  files: Array<{ id: number; name: string; path: string; type: string }>;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  if (!files.length) {
    return <div className="p-4 text-xs text-muted-foreground">No files yet.</div>;
  }
  return (
    <div className="space-y-0.5 p-2">
      {files.map((f) => (
        <div
          key={f.id}
          className={`group flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer text-sm transition-colors ${
            selectedId === f.id
              ? "bg-primary/20 text-foreground"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          }`}
          onClick={() => onSelect(f.id)}
        >
          {f.type === "directory" ? <Folder size={13} className="shrink-0" /> : <FileIcon size={13} className="shrink-0" />}
          <span className="flex-1 truncate font-mono text-xs">{f.name}</span>
          <button
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
            onClick={(e) => { e.stopPropagation(); onDelete(f.id); }}
          >
            <Trash2 size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}

export default function IDE() {
  const params = useParams<{ id: string }>();
  const projectId = Number(params.id);
  const queryClient = useQueryClient();

  const { data: project } = useGetProject(projectId);
  const { data: files, isLoading: filesLoading } = useListFiles(projectId);

  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [showAI, setShowAI] = useState(true);
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [newFileType, setNewFileType] = useState<"file" | "directory">("file");
  const [showDeploy, setShowDeploy] = useState(false);
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
  const [aiInput, setAiInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [MonacoEditor, setMonacoEditor] = useState<any>(null);

  const { data: selectedFile } = useGetFile(projectId, selectedFileId ?? 0, {
    query: { enabled: !!selectedFileId },
  });

  const updateFile = useUpdateFile();
  const createFile = useCreateFile();
  const deleteFile = useDeleteFile();
  const createDeployment = useCreateDeployment();
  const aiChat = useAiChat();

  useEffect(() => {
    import("@monaco-editor/react").then((m) => setMonacoEditor(() => m.default));
  }, []);

  useEffect(() => {
    if (files && files.length > 0 && !selectedFileId) {
      const first = files.find(f => f.type === "file");
      if (first) setSelectedFileId(first.id);
    }
  }, [files]);

  useEffect(() => {
    if (selectedFile?.content !== undefined) {
      setEditorContent(selectedFile.content ?? "");
      setIsDirty(false);
    }
  }, [selectedFile?.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiMessages]);

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
      },
    });
  }

  function handleDeleteFile(fileId: number) {
    deleteFile.mutate({ id: projectId, fileId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
        if (selectedFileId === fileId) {
          setSelectedFileId(null);
          setEditorContent("");
        }
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

  function handleAiSend() {
    if (!aiInput.trim() || aiChat.isPending) return;
    const msg = aiInput.trim();
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
        setAiMessages(prev => [...prev, {
          role: "assistant",
          content: data.reply,
          codeBlocks: data.codeBlocks,
        }]);
      },
      onError: () => {
        setAiMessages(prev => [...prev, { role: "assistant", content: "Sorry, I encountered an error. Please try again." }]);
      },
    });
  }

  const currentLang = selectedFile ? getLanguage(selectedFile.name) : "plaintext";

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top bar */}
        <div className="h-11 border-b border-border bg-card flex items-center gap-2 px-3 shrink-0">
          <Link href="/projects">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground gap-1">
              <LayoutPanelLeft size={12} /> Projects
            </Button>
          </Link>
          <span className="text-muted-foreground text-xs">/</span>
          <span className="text-sm font-medium truncate">{project?.name ?? "Loading..."}</span>
          {isDirty && <Badge variant="secondary" className="text-xs h-5 px-1.5">unsaved</Badge>}
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              onClick={handleSave}
              disabled={!isDirty || updateFile.isPending}
            >
              {updateFile.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              onClick={() => setShowAI(!showAI)}
            >
              <MessageSquare size={12} />
              AI
            </Button>
            <Button
              size="sm"
              className="h-7 px-3 text-xs gap-1"
              onClick={() => setShowDeploy(true)}
            >
              <Rocket size={12} /> Deploy
            </Button>
          </div>
        </div>

        {/* Main IDE area */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* File tree sidebar */}
          <div className="w-52 border-r border-border flex flex-col shrink-0 bg-sidebar">
            <div className="flex items-center justify-between px-3 py-2 border-b border-sidebar-border">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Files</span>
              <button
                className="text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowNewFile(true)}
              >
                <Plus size={14} />
              </button>
            </div>
            {filesLoading ? (
              <div className="p-3 space-y-2">
                {[1,2,3].map(i => <Skeleton key={i} className="h-6 rounded" />)}
              </div>
            ) : (
              <div className="flex-1 overflow-auto ide-scroll">
                <FileTree
                  files={files ?? []}
                  selectedId={selectedFileId}
                  onSelect={setSelectedFileId}
                  onDelete={handleDeleteFile}
                />
              </div>
            )}
          </div>

          {/* Editor */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {selectedFileId && selectedFile ? (
              <>
                <div className="h-8 bg-card border-b border-border flex items-center px-3 gap-2 shrink-0">
                  <FileIcon size={12} className="text-muted-foreground" />
                  <span className="text-xs font-mono text-muted-foreground">{selectedFile.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground font-mono">{currentLang}</span>
                </div>
                <div className="flex-1 overflow-hidden">
                  {MonacoEditor ? (
                    <MonacoEditor
                      height="100%"
                      language={currentLang}
                      value={editorContent}
                      theme="vs-dark"
                      onChange={(val: string | undefined) => {
                        setEditorContent(val ?? "");
                        setIsDirty(true);
                      }}
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
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
                  <Code2 size={20} className="text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">No file selected</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Select a file from the tree or create a new one</p>
                </div>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowNewFile(true)}>
                  <Plus size={13} /> New File
                </Button>
              </div>
            )}
          </div>

          {/* AI Chat panel */}
          {showAI && (
            <div className="w-80 border-l border-border flex flex-col shrink-0 bg-card">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <MessageSquare size={12} /> AI Assistant
                </span>
                <button onClick={() => setShowAI(false)} className="text-muted-foreground hover:text-foreground">
                  <X size={14} />
                </button>
              </div>

              <div className="flex-1 overflow-auto ide-scroll p-3 space-y-3">
                {aiMessages.length === 0 && (
                  <div className="text-xs text-muted-foreground text-center pt-8 px-2 space-y-2">
                    <MessageSquare size={24} className="mx-auto opacity-40" />
                    <p>Ask the AI anything about your code. It can see your current file.</p>
                  </div>
                )}
                {aiMessages.map((msg, i) => (
                  <div key={i} className={`text-xs ${msg.role === "user" ? "text-right" : ""}`}>
                    <div className={`inline-block max-w-full text-left rounded-lg px-3 py-2 ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    }`}>
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      {msg.codeBlocks && msg.codeBlocks.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {msg.codeBlocks.map((cb, ci) => (
                            <div key={ci} className="rounded bg-background border border-border overflow-hidden">
                              <div className="px-2 py-1 text-xs text-muted-foreground border-b border-border font-mono">
                                {cb.filename ?? cb.language}
                              </div>
                              <pre className="p-2 text-xs font-mono overflow-auto max-h-48 ide-scroll text-foreground">
                                <code>{cb.code}</code>
                              </pre>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {aiChat.isPending && (
                  <div className="text-xs">
                    <div className="inline-block bg-muted rounded-lg px-3 py-2">
                      <Loader2 size={12} className="animate-spin" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="p-2 border-t border-border">
                <div className="flex gap-1.5">
                  <Input
                    className="text-xs h-8 bg-background"
                    placeholder="Ask anything..."
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAiSend(); } }}
                  />
                  <Button size="icon" className="h-8 w-8 shrink-0" onClick={handleAiSend} disabled={aiChat.isPending || !aiInput.trim()}>
                    <SendHorizontal size={13} />
                  </Button>
                </div>
              </div>
            </div>
          )}
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
            <p className="text-sm text-muted-foreground">Deploy <strong>{project?.name}</strong> to a live URL. Your project will be built and hosted instantly.</p>
            <div className="bg-muted/30 rounded-lg p-4 text-sm space-y-1">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Region</span><span>us-east-1</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Domain</span><span className="font-mono">auto-assigned</span></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeploy(false)}>Cancel</Button>
            <Button onClick={handleDeploy} disabled={createDeployment.isPending} className="gap-2">
              {createDeployment.isPending ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
              {createDeployment.isPending ? "Deploying..." : "Deploy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
