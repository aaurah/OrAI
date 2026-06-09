import { useState, useEffect } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Github, Star, GitFork, GitBranch, GitCommit, GitPullRequest,
  AlertCircle, Search, Plus, Trash2, Lock, Globe, Eye, Code,
  ArrowUpFromLine, RefreshCw, ChevronRight, ChevronDown, X,
  Loader2, CheckCircle2, XCircle, MessageSquare, Tag, Zap,
  FileText, User, Bell, BookMarked, Upload, ExternalLink,
  Pencil, Settings2, FolderDown, Save, GitMerge, CheckCheck,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ── API helper ────────────────────────────────────────────────────────────────

const API = "/api/github";

async function ghApi(path: string, opts: RequestInit = {}) {
  const token = localStorage.getItem("github_token") ?? "";
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-github-token": token } : {}),
      ...(opts.headers as Record<string, string> ?? {}),
    },
  });
  if (res.status === 204) return null;
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface GhUser { login: string; name: string; avatar_url: string; bio: string; public_repos: number; followers: number; following: number; html_url: string; }
interface GhRepo { id: number; name: string; full_name: string; description: string; private: boolean; stargazers_count: number; forks_count: number; language: string; default_branch: string; html_url: string; owner: { login: string; avatar_url: string }; open_issues_count: number; }
interface GhBranch { name: string; commit: { sha: string; url: string }; protected: boolean; }
interface GhCommit { sha: string; commit: { message: string; author: { name: string; date: string } }; author: { login: string; avatar_url: string } | null; html_url: string; }
interface GhIssue { number: number; title: string; state: string; user: { login: string; avatar_url: string }; created_at: string; labels: Array<{ name: string; color: string }>; comments: number; body: string; html_url: string; }
interface GhPR { number: number; title: string; state: string; user: { login: string; avatar_url: string }; created_at: string; head: { ref: string }; base: { ref: string }; mergeable_state: string; html_url: string; body: string; }
interface GhFile { name: string; path: string; type: "file" | "dir"; size: number; download_url: string; }

type Tab = "overview" | "repos" | "branches" | "commits" | "issues" | "pulls" | "files" | "releases" | "actions" | "gists" | "search" | "notifications";

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(date: string) {
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function LangDot({ lang }: { lang: string }) {
  const colors: Record<string, string> = {
    JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572A5", Rust: "#dea584",
    Go: "#00ADD8", HTML: "#e34c26", CSS: "#563d7c", Java: "#b07219", Ruby: "#701516",
    "C++": "#f34b7d", C: "#555555", Shell: "#89e051", Kotlin: "#A97BFF",
  };
  const col = colors[lang] ?? "#8b949e";
  return <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style={{ background: col }} />;
}

function RepoCard({ repo, onClick, selected }: { repo: GhRepo; onClick: () => void; selected: boolean }) {
  return (
    <div
      onClick={onClick}
      className={`p-4 rounded-lg border cursor-pointer transition-all ${selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/30"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-foreground truncate">{repo.name}</span>
            <Badge variant={repo.private ? "secondary" : "outline"} className="text-[10px] h-4 px-1.5 shrink-0">
              {repo.private ? <><Lock size={9} className="mr-0.5" />Private</> : <><Globe size={9} className="mr-0.5" />Public</>}
            </Badge>
          </div>
          {repo.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{repo.description}</p>}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
            {repo.language && <span className="flex items-center"><LangDot lang={repo.language} />{repo.language}</span>}
            <span className="flex items-center gap-0.5"><Star size={11} />{repo.stargazers_count}</span>
            <span className="flex items-center gap-0.5"><GitFork size={11} />{repo.forks_count}</span>
            <span className="flex items-center gap-0.5"><AlertCircle size={11} />{repo.open_issues_count}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function GitHubPage() {
  const { toast } = useToast();

  // Auth
  const [token, setToken] = useState(localStorage.getItem("github_token") ?? "");
  const [tokenInput, setTokenInput] = useState("");
  const [user, setUser] = useState<GhUser | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);

  // Repo selection
  const [repos, setRepos] = useState<GhRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<GhRepo | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  // Tab data
  const [branches, setBranches]       = useState<GhBranch[]>([]);
  const [commits, setCommits]         = useState<GhCommit[]>([]);
  const [issues, setIssues]           = useState<GhIssue[]>([]);
  const [pulls, setPulls]             = useState<GhPR[]>([]);
  const [files, setFiles]             = useState<GhFile[]>([]);
  const [filePath, setFilePath]       = useState<string[]>([]);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [releases, setReleases]       = useState<any[]>([]);
  const [actions, setActions]         = useState<any[]>([]);
  const [gists, setGists]             = useState<any[]>([]);
  const [notifications, setNotif]     = useState<any[]>([]);
  const [searchResults, setSearchRes] = useState<any[]>([]);
  const [tabLoading, setTabLoading]   = useState(false);
  const [issueState, setIssueState]   = useState<"open" | "closed">("open");
  const [prState, setPrState]         = useState<"open" | "closed" | "all">("open");
  const [commitBranch, setCommitBranch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchType, setSearchType]   = useState<"repositories" | "users" | "code" | "issues">("repositories");

  // Dialogs
  const [showCreateRepo, setShowCreateRepo]   = useState(false);
  const [showCreateIssue, setShowCreateIssue] = useState(false);
  const [showCreateBranch, setShowCreateBranch] = useState(false);
  const [showCreatePR, setShowCreatePR]       = useState(false);
  const [showCreateRelease, setShowCreateRelease] = useState(false);
  const [showPushProject, setShowPushProject] = useState(false);
  const [showEditRepo, setShowEditRepo]       = useState(false);
  const [showImportRepo, setShowImportRepo]   = useState(false);
  const [selectedIssue, setSelectedIssue]     = useState<GhIssue | null>(null);
  const [selectedPR, setSelectedPR]           = useState<GhPR | null>(null);
  const [issueComments, setIssueComments]     = useState<any[]>([]);
  const [commentText, setCommentText]         = useState("");
  const [newComment, setNewComment]           = useState("");

  // Forms
  const [newRepo, setNewRepo] = useState({ name: "", description: "", private: false, auto_init: true });
  const [newIssue, setNewIssue] = useState({ title: "", body: "" });
  const [newBranch, setNewBranch] = useState({ name: "", from: "" });
  const [newPR, setNewPR] = useState({ title: "", body: "", head: "", base: "" });
  const [newRelease, setNewRelease] = useState({ tag_name: "", name: "", body: "", draft: false, prerelease: false });
  const [pushMsg, setPushMsg] = useState("Push from CloudIDE");
  const [pushBranch, setPushBranch] = useState("main");

  // Edit repo form
  const [editRepoForm, setEditRepoForm] = useState({ name: "", description: "", private: false, homepage: "" });

  // Inline file editing
  const [fileEditMode, setFileEditMode]       = useState(false);
  const [fileEditContent, setFileEditContent] = useState("");
  const [fileEditMsg, setFileEditMsg]         = useState("");
  const [fileSha, setFileSha]                 = useState("");
  const [fileEditSaving, setFileEditSaving]   = useState(false);

  // Import to CloudIDE
  const [importProjectName, setImportProjectName] = useState("");
  const [importLoading, setImportLoading]         = useState(false);
  const [importProgress, setImportProgress]       = useState("");

  // Push project
  const [localProjects, setLocalProjects]   = useState<any[]>([]);
  const [pushProjectId, setPushProjectId]   = useState<number | null>(null);
  const [pushLoading, setPushLoading]       = useState(false);
  const [pushResults, setPushResults]       = useState<Array<{ name: string; status: string; error?: string }> | null>(null);

  // ── Auth ───────────────────────────────────────────────────────────────────

  async function connect(t?: string) {
    const tok = t ?? tokenInput.trim();
    if (!tok) return;
    setLoading(true);
    try {
      localStorage.setItem("github_token", tok);
      setToken(tok);
      const data = await ghApi(`${API}/user`);
      if (data?.login) {
        setUser(data);
        setConnected(true);
        loadRepos();
        toast({ title: `Connected as ${data.login}` });
      } else {
        toast({ title: "Invalid token", variant: "destructive" });
        localStorage.removeItem("github_token");
      }
    } catch {
      toast({ title: "Connection failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function disconnect() {
    localStorage.removeItem("github_token");
    setToken(""); setUser(null); setConnected(false); setRepos([]); setSelectedRepo(null);
  }

  useEffect(() => {
    if (token) connect(token);
  }, []);

  // ── Load repos ─────────────────────────────────────────────────────────────

  async function loadRepos() {
    const data = await ghApi(`${API}/repos?type=owner&sort=updated&per_page=50`);
    if (Array.isArray(data)) setRepos(data);
  }

  // ── Select repo ────────────────────────────────────────────────────────────

  function selectRepo(repo: GhRepo) {
    setSelectedRepo(repo);
    setTab("overview");
    setFilePath([]);
    setFileContent(null);
    setCommitBranch(repo.default_branch);
  }

  // ── Scroll to top when tab changes ────────────────────────────────────────
  useEffect(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTop = 0;
  }, [tab]);

  // ── Tab data loading ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedRepo) return;
    loadTab();
  }, [tab, selectedRepo, issueState, prState]);

  async function loadTab() {
    if (!selectedRepo) return;
    const { owner: { login }, name } = selectedRepo;
    setTabLoading(true);
    try {
      if (tab === "branches") {
        const d = await ghApi(`${API}/repos/${login}/${name}/branches`);
        if (Array.isArray(d)) setBranches(d);
        setNewBranch(b => ({ ...b, from: selectedRepo.default_branch }));
      } else if (tab === "commits") {
        const qs = commitBranch ? `?sha=${commitBranch}` : "";
        const d = await ghApi(`${API}/repos/${login}/${name}/commits${qs}`);
        if (Array.isArray(d)) setCommits(d);
      } else if (tab === "issues") {
        const d = await ghApi(`${API}/repos/${login}/${name}/issues?state=${issueState}&per_page=50`);
        if (Array.isArray(d)) setIssues(d);
      } else if (tab === "pulls") {
        const d = await ghApi(`${API}/repos/${login}/${name}/pulls?state=${prState}&per_page=50`);
        if (Array.isArray(d)) setPulls(d);
      } else if (tab === "files") {
        const path = filePath.join("/");
        const d = await ghApi(`${API}/repos/${login}/${name}/contents${path ? "/" + path : ""}`);
        if (Array.isArray(d)) { setFiles(d); setFileContent(null); }
        else if (d?.content) { setFileContent(atob(d.content.replace(/\s/g, ""))); setFiles([]); }
      } else if (tab === "releases") {
        const d = await ghApi(`${API}/repos/${login}/${name}/releases`);
        if (Array.isArray(d)) setReleases(d);
      } else if (tab === "actions") {
        const d = await ghApi(`${API}/repos/${login}/${name}/actions/runs`);
        if (d?.workflow_runs) setActions(d.workflow_runs);
      }
    } finally {
      setTabLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "gists" && connected) {
      ghApi(`${API}/gists`).then(d => { if (Array.isArray(d)) setGists(d); });
    }
    if (tab === "notifications" && connected) {
      ghApi(`${API}/notifications`).then(d => { if (Array.isArray(d)) setNotif(d); });
    }
  }, [tab, connected]);

  useEffect(() => {
    if (tab === "commits" && selectedRepo) loadTab();
  }, [commitBranch]);

  // ── File browser ───────────────────────────────────────────────────────────

  async function browseFile(file: GhFile) {
    if (file.type === "dir") {
      setFilePath([...filePath, file.name]);
      setFileContent(null);
      setTimeout(loadTab, 0);
    } else {
      if (!selectedRepo) return;
      const path = [...filePath, file.name].join("/");
      const d = await ghApi(`${API}/repos/${selectedRepo.owner.login}/${selectedRepo.name}/contents/${path}`);
      if (d?.content) setFileContent(atob(d.content.replace(/\s/g, "")));
    }
  }

  // ── Issue comments ─────────────────────────────────────────────────────────

  async function openIssue(issue: GhIssue) {
    setSelectedIssue(issue);
    if (!selectedRepo) return;
    const d = await ghApi(`${API}/repos/${selectedRepo.owner.login}/${selectedRepo.name}/issues/${issue.number}/comments`);
    if (Array.isArray(d)) setIssueComments(d);
  }

  async function postComment() {
    if (!selectedRepo || !selectedIssue || !newComment.trim()) return;
    const d = await ghApi(
      `${API}/repos/${selectedRepo.owner.login}/${selectedRepo.name}/issues/${selectedIssue.number}/comments`,
      { method: "POST", body: JSON.stringify({ body: newComment }) }
    );
    if (d?.id) { setIssueComments(c => [...c, d]); setNewComment(""); toast({ title: "Comment posted" }); }
  }

  async function toggleIssue(issue: GhIssue) {
    if (!selectedRepo) return;
    const state = issue.state === "open" ? "closed" : "open";
    await ghApi(`${API}/repos/${selectedRepo.owner.login}/${selectedRepo.name}/issues/${issue.number}`, {
      method: "PATCH", body: JSON.stringify({ state }),
    });
    setIssues(is => is.map(i => i.number === issue.number ? { ...i, state } : i));
    if (selectedIssue?.number === issue.number) setSelectedIssue(i => i ? { ...i, state } : i);
    toast({ title: `Issue #${issue.number} ${state}` });
  }

  // ── Create repo ────────────────────────────────────────────────────────────

  async function createRepo() {
    const d = await ghApi(`${API}/repos`, { method: "POST", body: JSON.stringify(newRepo) });
    if (d?.id) {
      setRepos(rs => [d, ...rs]);
      setShowCreateRepo(false);
      setNewRepo({ name: "", description: "", private: false, auto_init: true });
      toast({ title: `Repository "${d.name}" created` });
      selectRepo(d);
    } else {
      toast({ title: d?.message ?? "Failed", variant: "destructive" });
    }
  }

  async function deleteRepo(repo: GhRepo) {
    if (!confirm(`Delete "${repo.full_name}"? This cannot be undone.`)) return;
    await ghApi(`${API}/repos/${repo.owner.login}/${repo.name}`, { method: "DELETE" });
    setRepos(rs => rs.filter(r => r.id !== repo.id));
    if (selectedRepo?.id === repo.id) setSelectedRepo(null);
    toast({ title: `Deleted ${repo.name}` });
  }

  async function forkRepo() {
    if (!selectedRepo) return;
    const d = await ghApi(`${API}/repos/${selectedRepo.owner.login}/${selectedRepo.name}/forks`, { method: "POST" });
    if (d?.id) { toast({ title: `Forked as ${d.full_name}` }); loadRepos(); }
  }

  // ── Create branch ──────────────────────────────────────────────────────────

  async function createBranch() {
    if (!selectedRepo || !newBranch.name || !newBranch.from) return;
    const fromBranch = await ghApi(`${API}/repos/${selectedRepo.owner.login}/${selectedRepo.name}/branches/${newBranch.from}`);
    if (!fromBranch?.commit?.sha) return toast({ title: "Cannot find source branch SHA", variant: "destructive" });
    const d = await ghApi(`${API}/repos/${selectedRepo.owner.login}/${selectedRepo.name}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${newBranch.name}`, sha: fromBranch.commit.sha }),
    });
    if (d?.ref) {
      setBranches(bs => [...bs, { name: newBranch.name, commit: { sha: fromBranch.commit.sha, url: "" }, protected: false }]);
      setShowCreateBranch(false);
      setNewBranch({ name: "", from: selectedRepo.default_branch });
      toast({ title: `Branch "${newBranch.name}" created` });
    } else {
      toast({ title: d?.message ?? "Failed", variant: "destructive" });
    }
  }

  async function deleteBranch(branch: GhBranch) {
    if (!selectedRepo) return;
    if (!confirm(`Delete branch "${branch.name}"?`)) return;
    await ghApi(`${API}/repos/${selectedRepo.owner.login}/${selectedRepo.name}/git/refs/heads/${branch.name}`, { method: "DELETE" });
    setBranches(bs => bs.filter(b => b.name !== branch.name));
    toast({ title: `Branch "${branch.name}" deleted` });
  }

  // ── Create issue ───────────────────────────────────────────────────────────

  async function createIssue() {
    if (!selectedRepo || !newIssue.title) return;
    const d = await ghApi(`${API}/repos/${selectedRepo.owner.login}/${selectedRepo.name}/issues`, {
      method: "POST", body: JSON.stringify(newIssue),
    });
    if (d?.number) {
      setIssues(is => [d, ...is]);
      setShowCreateIssue(false);
      setNewIssue({ title: "", body: "" });
      toast({ title: `Issue #${d.number} created` });
    }
  }

  // ── Create PR ──────────────────────────────────────────────────────────────

  async function createPR() {
    if (!selectedRepo || !newPR.title || !newPR.head || !newPR.base) return;
    const d = await ghApi(`${API}/repos/${selectedRepo.owner.login}/${selectedRepo.name}/pulls`, {
      method: "POST", body: JSON.stringify(newPR),
    });
    if (d?.number) {
      setPulls(ps => [d, ...ps]);
      setShowCreatePR(false);
      setNewPR({ title: "", body: "", head: "", base: "" });
      toast({ title: `PR #${d.number} created` });
    } else {
      toast({ title: d?.message ?? "Failed", variant: "destructive" });
    }
  }

  async function mergePR(pr: GhPR) {
    if (!selectedRepo) return;
    const d = await ghApi(`${API}/repos/${selectedRepo.owner.login}/${selectedRepo.name}/pulls/${pr.number}/merge`, {
      method: "PUT", body: JSON.stringify({ merge_method: "merge" }),
    });
    if (d?.merged) {
      setPulls(ps => ps.map(p => p.number === pr.number ? { ...p, state: "closed" } : p));
      toast({ title: `PR #${pr.number} merged ✓` });
    } else {
      toast({ title: d?.message ?? "Cannot merge", variant: "destructive" });
    }
  }

  async function closePR(pr: GhPR) {
    if (!selectedRepo) return;
    await ghApi(`${API}/repos/${selectedRepo.owner.login}/${selectedRepo.name}/pulls/${pr.number}`, {
      method: "PATCH", body: JSON.stringify({ state: "closed" }),
    });
    setPulls(ps => ps.map(p => p.number === pr.number ? { ...p, state: "closed" } : p));
    toast({ title: `PR #${pr.number} closed` });
  }

  // ── Create release ─────────────────────────────────────────────────────────

  async function createRelease() {
    if (!selectedRepo || !newRelease.tag_name) return;
    const d = await ghApi(`${API}/repos/${selectedRepo.owner.login}/${selectedRepo.name}/releases`, {
      method: "POST", body: JSON.stringify(newRelease),
    });
    if (d?.id) {
      setReleases(rs => [d, ...rs]);
      setShowCreateRelease(false);
      toast({ title: `Release "${d.tag_name}" published` });
    }
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  async function doSearch() {
    if (!searchQuery.trim()) return;
    setTabLoading(true);
    const d = await ghApi(`${API}/search/${searchType}?q=${encodeURIComponent(searchQuery)}&per_page=20`);
    const items = d?.items ?? d ?? [];
    setSearchRes(Array.isArray(items) ? items : []);
    setTabLoading(false);
  }

  // ── Star / Fork ────────────────────────────────────────────────────────────

  async function starRepo(repo: GhRepo, star: boolean) {
    const method = star ? "PUT" : "DELETE";
    await ghApi(`${API}/user/starred/${repo.owner.login}/${repo.name}`, { method });
    toast({ title: star ? `Starred ${repo.name}` : `Unstarred ${repo.name}` });
    setRepos(rs => rs.map(r => r.id === repo.id ? { ...r, stargazers_count: r.stargazers_count + (star ? 1 : -1) } : r));
  }

  // ── Edit Repo ──────────────────────────────────────────────────────────────

  function openEditRepo() {
    if (!selectedRepo) return;
    setEditRepoForm({
      name: selectedRepo.name,
      description: selectedRepo.description ?? "",
      private: selectedRepo.private,
      homepage: "",
    });
    setShowEditRepo(true);
  }

  async function updateRepo() {
    if (!selectedRepo) return;
    const d = await ghApi(`${API}/repos/${selectedRepo.owner.login}/${selectedRepo.name}`, {
      method: "PATCH",
      body: JSON.stringify(editRepoForm),
    });
    if (d?.id) {
      const updated = { ...selectedRepo, name: d.name, description: d.description, private: d.private, full_name: d.full_name };
      setSelectedRepo(updated);
      setRepos(rs => rs.map(r => r.id === d.id ? updated : r));
      setShowEditRepo(false);
      toast({ title: "Repository updated" });
    } else {
      toast({ title: d?.message ?? "Update failed", variant: "destructive" });
    }
  }

  // ── Inline file editing ────────────────────────────────────────────────────

  async function enterFileEditMode() {
    if (fileContent === null || !selectedRepo) return;
    const path = filePath.join("/");
    const d = await ghApi(`${API}/repos/${selectedRepo.owner.login}/${selectedRepo.name}/contents/${path}`);
    setFileSha(d?.sha ?? "");
    setFileEditContent(fileContent);
    setFileEditMsg(`Update ${filePath[filePath.length - 1] ?? "file"}`);
    setFileEditMode(true);
  }

  async function commitFile() {
    if (!selectedRepo) return;
    const path = filePath.join("/");
    setFileEditSaving(true);
    try {
      const encoded = btoa(unescape(encodeURIComponent(fileEditContent)));
      const payload: any = {
        message: fileEditMsg || `Update ${filePath[filePath.length - 1]}`,
        content: encoded,
        branch: selectedRepo.default_branch,
      };
      if (fileSha) payload.sha = fileSha;
      const d = await ghApi(`${API}/repos/${selectedRepo.owner.login}/${selectedRepo.name}/contents/${path}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      if (d?.content) {
        setFileContent(fileEditContent);
        setFileSha(d.content.sha);
        setFileEditMode(false);
        toast({ title: "File committed ✓" });
      } else {
        toast({ title: d?.message ?? "Commit failed", variant: "destructive" });
      }
    } finally {
      setFileEditSaving(false);
    }
  }

  // ── Import repo to CloudIDE project ───────────────────────────────────────

  function openImportRepo() {
    if (!selectedRepo) return;
    setImportProjectName(selectedRepo.name);
    setImportProgress("");
    setShowImportRepo(true);
  }

  async function importToCloudIDE() {
    if (!selectedRepo || !importProjectName.trim()) return;
    setImportLoading(true);
    try {
      setImportProgress("Fetching file tree from GitHub…");
      const defaultBranch = selectedRepo.default_branch || "main";

      // Resolve branch → commit SHA → tree SHA (direct branch name fails on git/trees)
      const branchData = await ghApi(`${API}/repos/${selectedRepo.owner.login}/${selectedRepo.name}/branches/${defaultBranch}`);
      if (!branchData?.commit?.sha) {
        throw new Error(branchData?.message ?? "Could not resolve branch");
      }
      const commitData = await ghApi(`${API}/repos/${selectedRepo.owner.login}/${selectedRepo.name}/commits/${branchData.commit.sha}`);
      const treeSha = commitData?.commit?.tree?.sha;
      if (!treeSha) {
        throw new Error("Could not get tree SHA from commit");
      }

      const tree = await ghApi(`${API}/repos/${selectedRepo.owner.login}/${selectedRepo.name}/git/trees/${treeSha}?recursive=1`);
      if (!tree?.tree) {
        throw new Error(tree?.message ?? "Failed to fetch repository file tree");
      }
      const SKIP_NAMES = new Set([
        ".replit", ".replitignore", "replit.nix",
        "pnpm-lock.yaml", "yarn.lock", "package-lock.json",
        ".npmrc", ".yarnrc", ".yarnrc.yml",
        ".gitignore", ".gitattributes", ".editorconfig",
        "Thumbs.db", ".DS_Store",
      ]);
      const SKIP_TOP_DIRS = new Set([".github", "node_modules", ".git", "dist", "build", ".next", "__pycache__"]);

      const blobs: any[] = tree.tree
        .filter((f: any) => {
          if (f.type !== "blob" || !f.path) return false;
          const parts = f.path.split("/");
          if (parts.length > 3) return false; // skip deeply-nested files (dist, build outputs)
          const name = parts[parts.length - 1];
          const topDir = parts[0];
          // Skip minified/compiled bundles by extension
          if (/\.(min\.js|min\.css|mjs\.map|js\.map|css\.map)$/.test(name)) return false;
          return !SKIP_NAMES.has(name) && !SKIP_TOP_DIRS.has(topDir) && !name.startsWith(".");
        })
        .slice(0, 50);

      setImportProgress("Creating CloudIDE project…");
      const projRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: importProjectName.trim(),
          description: selectedRepo.description || `Imported from ${selectedRepo.full_name}`,
          language: (selectedRepo.language ?? "html").toLowerCase() || "html",
          template: "blank",
          isPublic: !selectedRepo.private,
        }),
      });
      const proj = await projRes.json();
      if (!proj?.id) throw new Error("Project creation failed");

      for (let i = 0; i < blobs.length; i++) {
        const file = blobs[i];
        setImportProgress(`Importing file ${i + 1}/${blobs.length}: ${file.path}`);
        try {
          const contentRes = await ghApi(`${API}/repos/${selectedRepo.owner.login}/${selectedRepo.name}/contents/${file.path}`);
          if (contentRes?.content) {
            const decoded = atob(contentRes.content.replace(/\s/g, ""));
            // Use full path as name for nested files to avoid basename collisions
            const displayName = file.path.includes("/") ? file.path : (file.path.split("/").pop() ?? file.path);
            await fetch(`/api/projects/${proj.id}/files`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: displayName,
                path: `/${file.path}`,
                type: "file",
                content: decoded,
              }),
            });
          }
        } catch { /* skip binary / unreadable files */ }
      }

      setImportLoading(false);
      setShowImportRepo(false);
      toast({ title: `Imported ${blobs.length} files into "${importProjectName}"` });
      window.location.href = `/projects/${proj.id}`;
    } catch (e: any) {
      setImportLoading(false);
      setImportProgress("");
      toast({ title: e.message ?? "Import failed", variant: "destructive" });
    }
  }

  // ── Push CloudIDE project → GitHub ─────────────────────────────────────────

  async function openPushProject() {
    setPushResults(null);
    setPushProjectId(null);
    const data = await fetch("/api/projects").then(r => r.json()).catch(() => []);
    if (Array.isArray(data)) setLocalProjects(data);
    setShowPushProject(true);
  }

  async function doPushProject() {
    if (!selectedRepo || !pushProjectId) return;
    setPushLoading(true);
    setPushResults(null);
    try {
      const files = await fetch(`/api/projects/${pushProjectId}/files`).then(r => r.json());
      if (!Array.isArray(files)) throw new Error("Failed to load project files");
      const d = await ghApi(`${API}/repos/${selectedRepo.owner.login}/${selectedRepo.name}/push-project`, {
        method: "POST",
        body: JSON.stringify({
          files: files.filter((f: any) => f.type === "file").map((f: any) => ({ name: f.name, content: f.content ?? "" })),
          branch: pushBranch,
          commitMessage: pushMsg,
        }),
      });
      if (d?.results) {
        setPushResults(d.results);
        const ok = d.results.filter((r: any) => r.status !== "error").length;
        toast({ title: `Pushed ${ok}/${d.results.length} files to ${selectedRepo.name}` });
      } else {
        toast({ title: d?.message ?? "Push failed", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: e.message ?? "Push failed", variant: "destructive" });
    } finally {
      setPushLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!connected) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[80vh] px-4">
          <div className="w-full max-w-md space-y-6">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto">
                <Github size={32} className="text-foreground" />
              </div>
              <h1 className="text-2xl font-bold">Connect GitHub</h1>
              <p className="text-muted-foreground text-sm">
                Enter a GitHub Personal Access Token with <code className="text-xs bg-muted px-1.5 py-0.5 rounded">repo</code>,{" "}
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">read:user</code>,{" "}
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">notifications</code> scopes.
              </p>
            </div>
            <div className="space-y-3">
              <Input
                type="password"
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && connect()}
                className="font-mono text-sm"
              />
              <Button className="w-full gap-2" onClick={() => connect()} disabled={loading || !tokenInput.trim()}>
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Github size={16} />}
                Connect GitHub
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                <a href="https://github.com/settings/tokens/new?scopes=repo,read:user,notifications,gist&description=CloudIDE" target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-foreground flex items-center justify-center gap-1">
                  Generate token on GitHub <ExternalLink size={11} />
                </a>
              </p>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // ── Tabs list ──────────────────────────────────────────────────────────────

  const globalTabs: { key: Tab; label: string; icon: any; global?: boolean }[] = [
    { key: "overview", label: "Overview", icon: Github, global: true },
    { key: "repos",    label: "Repos",    icon: BookMarked, global: true },
    { key: "gists",    label: "Gists",    icon: FileText, global: true },
    { key: "search",   label: "Search",   icon: Search, global: true },
    { key: "notifications", label: "Notif.", icon: Bell, global: true },
  ];

  const repoTabs: { key: Tab; label: string; icon: any }[] = [
    { key: "files",    label: "Files",    icon: Code },
    { key: "branches", label: "Branches", icon: GitBranch },
    { key: "commits",  label: "Commits",  icon: GitCommit },
    { key: "issues",   label: "Issues",   icon: AlertCircle },
    { key: "pulls",    label: "PRs",      icon: GitPullRequest },
    { key: "releases", label: "Releases", icon: Tag },
    { key: "actions",  label: "Actions",  icon: Zap },
  ];

  const activeTabs = selectedRepo ? [...globalTabs.filter(t => t.global), ...repoTabs] : globalTabs;

  // ── Tab content ────────────────────────────────────────────────────────────

  function renderTabContent() {
    if (tabLoading) return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );

    // ── Overview ───────────────────────────────────────────────────────────
    if (tab === "overview" && user) return (
      <div className="space-y-6">
        <div className="flex items-center gap-4 p-4 bg-muted/30 rounded-xl border border-border">
          <img src={user.avatar_url} alt={user.login} className="w-16 h-16 rounded-full ring-2 ring-border" />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold">{user.name || user.login}</h2>
            <p className="text-muted-foreground text-sm">@{user.login}</p>
            {user.bio && <p className="text-sm mt-1 text-foreground/80">{user.bio}</p>}
            <div className="flex gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
              <span><strong className="text-foreground">{user.public_repos}</strong> repos</span>
              <span><strong className="text-foreground">{user.followers}</strong> followers</span>
              <span><strong className="text-foreground">{user.following}</strong> following</span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <a href={user.html_url} target="_blank" rel="noopener">
              <Button size="sm" variant="outline" className="gap-1.5 text-xs"><ExternalLink size={12} />View on GitHub</Button>
            </a>
            <Button size="sm" variant="destructive" onClick={disconnect} className="text-xs">Disconnect</Button>
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold mb-3">Recent Repositories</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {repos.slice(0, 6).map(r => (
              <RepoCard key={r.id} repo={r} selected={selectedRepo?.id === r.id} onClick={() => { selectRepo(r); setTab("files"); }} />
            ))}
          </div>
        </div>
      </div>
    );

    // ── Repos ──────────────────────────────────────────────────────────────
    if (tab === "repos") return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{repos.length} Repositories</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={loadRepos} className="gap-1.5 text-xs"><RefreshCw size={12} />Refresh</Button>
            <Button size="sm" onClick={() => setShowCreateRepo(true)} className="gap-1.5 text-xs"><Plus size={12} />New Repo</Button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {repos.map(r => (
            <div key={r.id} className="relative group">
              <RepoCard repo={r} selected={selectedRepo?.id === r.id} onClick={() => selectRepo(r)} />
              <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={e => { e.stopPropagation(); starRepo(r, true); }} className="p-1 hover:text-yellow-400 text-muted-foreground" title="Star">
                  <Star size={12} />
                </button>
                <button onClick={e => { e.stopPropagation(); deleteRepo(r); }} className="p-1 hover:text-destructive text-muted-foreground" title="Delete">
                  <Trash2 size={12} />
                </button>
                <a href={r.html_url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}>
                  <button className="p-1 hover:text-foreground text-muted-foreground" title="Open on GitHub"><ExternalLink size={12} /></button>
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    );

    // ── Files ──────────────────────────────────────────────────────────────
    if (tab === "files" && selectedRepo) return (
      <div className="space-y-3">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          <button onClick={() => { setFilePath([]); setFileContent(null); setFileEditMode(false); setTimeout(loadTab, 0); }} className="hover:text-foreground font-medium">{selectedRepo.name}</button>
          {filePath.map((p, i) => (
            <span key={`bc-${i}`} className="flex items-center gap-2">
              <ChevronRight size={12} />
              <button onClick={() => { setFilePath(fp => fp.slice(0, i + 1)); setFileContent(null); setFileEditMode(false); setTimeout(loadTab, 0); }} className="hover:text-foreground">{p}</button>
            </span>
          ))}
        </div>

        {/* File viewer / editor */}
        {fileContent !== null ? (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border gap-2">
              <span className="text-xs font-mono text-muted-foreground truncate">{filePath[filePath.length - 1]}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                {!fileEditMode ? (
                  <Button size="sm" variant="outline" className="h-6 text-[11px] gap-1 px-2" onClick={enterFileEditMode}>
                    <Pencil size={10} /> Edit
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="h-6 text-[11px] px-2" onClick={() => setFileEditMode(false)}>
                    Cancel
                  </Button>
                )}
                <button onClick={() => { setFileContent(null); setFilePath(fp => fp.slice(0, -1)); setFileEditMode(false); setTimeout(loadTab, 0); }} className="text-muted-foreground hover:text-foreground">
                  <X size={13} />
                </button>
              </div>
            </div>

            {fileEditMode ? (
              <div className="space-y-0">
                <Textarea
                  className="font-mono text-xs rounded-none border-0 border-b border-border focus-visible:ring-0 min-h-[55vh] resize-y"
                  value={fileEditContent}
                  onChange={e => setFileEditContent(e.target.value)}
                  spellCheck={false}
                />
                <div className="flex items-center gap-2 p-2 bg-muted/30">
                  <Input
                    className="h-7 text-xs flex-1 bg-background"
                    placeholder="Commit message…"
                    value={fileEditMsg}
                    onChange={e => setFileEditMsg(e.target.value)}
                  />
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1.5 shrink-0"
                    onClick={commitFile}
                    disabled={fileEditSaving}
                  >
                    {fileEditSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                    Commit
                  </Button>
                </div>
              </div>
            ) : (
              <pre className="p-4 text-xs font-mono overflow-auto max-h-[60vh] ide-scroll text-foreground whitespace-pre-wrap break-words">{fileContent}</pre>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="px-3 py-2 bg-muted/30 border-b border-border flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Branch: <span className="font-mono">{selectedRepo.default_branch}</span></span>
              <span className="text-xs text-muted-foreground">{files.length} items</span>
            </div>
            {files.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Empty directory</p> : (
              <div className="divide-y divide-border">
                {files.sort((a, b) => (a.type === "dir" ? -1 : 1) - (b.type === "dir" ? -1 : 1)).map(f => (
                  <button key={f.path} onClick={() => browseFile(f)} className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/40 text-sm text-left group">
                    {f.type === "dir" ? <Folder size={14} className="text-blue-400 shrink-0" /> : <FileText size={14} className="text-muted-foreground shrink-0" />}
                    <span className={f.type === "dir" ? "font-medium" : ""}>{f.name}</span>
                    {f.type === "file" && <span className="ml-auto text-xs text-muted-foreground">{(f.size / 1024).toFixed(1)} KB</span>}
                    <ChevronRight size={12} className="text-muted-foreground opacity-0 group-hover:opacity-100 ml-1" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );

    // ── Branches ───────────────────────────────────────────────────────────
    if (tab === "branches" && selectedRepo) return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{branches.length} Branches</h3>
          <Button size="sm" onClick={() => setShowCreateBranch(true)} className="gap-1.5 text-xs"><Plus size={12} />New Branch</Button>
        </div>
        <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
          {branches.map(b => (
            <div key={b.name} className="flex items-center gap-3 px-4 py-3">
              <GitBranch size={14} className="text-muted-foreground shrink-0" />
              <span className="flex-1 font-mono text-sm">{b.name}</span>
              {b.name === selectedRepo.default_branch && <Badge variant="secondary" className="text-[10px] h-4">default</Badge>}
              {b.protected && <Badge variant="outline" className="text-[10px] h-4"><Lock size={8} className="mr-0.5" />protected</Badge>}
              <span className="text-xs text-muted-foreground font-mono truncate max-w-[80px]">{b.commit.sha.slice(0, 7)}</span>
              {b.name !== selectedRepo.default_branch && !b.protected && (
                <button onClick={() => deleteBranch(b)} className="text-muted-foreground hover:text-destructive ml-1"><Trash2 size={13} /></button>
              )}
            </div>
          ))}
        </div>
      </div>
    );

    // ── Commits ────────────────────────────────────────────────────────────
    if (tab === "commits" && selectedRepo) return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold">{commits.length} Commits</h3>
          <Select value={commitBranch || selectedRepo.default_branch} onValueChange={setCommitBranch}>
            <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{branches.map(b => <SelectItem key={b.name} value={b.name}>{b.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          {commits.map(c => (
            <div key={c.sha} className="flex gap-3 p-3 rounded-lg border border-border hover:bg-muted/20 transition-colors">
              <img src={c.author?.avatar_url ?? `https://github.com/identicons/${c.commit.author.name}.png`} className="w-7 h-7 rounded-full shrink-0 mt-0.5" alt="" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium line-clamp-1">{c.commit.message.split("\n")[0]}</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                  <span>{c.commit.author.name}</span>
                  <span>{timeAgo(c.commit.author.date)}</span>
                  <a href={c.html_url} target="_blank" rel="noopener" className="font-mono hover:text-foreground flex items-center gap-0.5">{c.sha.slice(0, 7)}<ExternalLink size={10} /></a>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );

    // ── Issues ─────────────────────────────────────────────────────────────
    if (tab === "issues" && selectedRepo) return (
      <div className="flex gap-4 h-full min-h-0">
        <div className="flex-1 space-y-3 overflow-auto ide-scroll">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-1.5">
              {(["open", "closed"] as const).map(s => (
                <Button key={s} size="sm" variant={issueState === s ? "default" : "outline"} className="h-7 text-xs capitalize" onClick={() => setIssueState(s)}>{s}</Button>
              ))}
            </div>
            <Button size="sm" onClick={() => setShowCreateIssue(true)} className="gap-1.5 text-xs h-7"><Plus size={12} />New Issue</Button>
          </div>
          {issues.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">No {issueState} issues.</p>}
          {issues.map(issue => (
            <div key={issue.number} onClick={() => openIssue(issue)} className={`p-3 rounded-lg border cursor-pointer transition-colors hover:bg-muted/20 ${selectedIssue?.number === issue.number ? "border-primary" : "border-border"}`}>
              <div className="flex items-start gap-2">
                <AlertCircle size={14} className={`mt-0.5 shrink-0 ${issue.state === "open" ? "text-green-400" : "text-red-400"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium line-clamp-1">#{issue.number} {issue.title}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                    <span>@{issue.user.login}</span><span>{timeAgo(issue.created_at)}</span>
                    {issue.labels.map(l => <span key={l.name} className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: `#${l.color}22`, color: `#${l.color}` }}>{l.name}</span>)}
                    {issue.comments > 0 && <span className="flex items-center gap-0.5"><MessageSquare size={10} />{issue.comments}</span>}
                  </div>
                </div>
                <button onClick={e => { e.stopPropagation(); toggleIssue(issue); }} className="shrink-0 text-muted-foreground hover:text-foreground text-xs px-2 py-1 rounded border border-border hover:border-primary">
                  {issue.state === "open" ? "Close" : "Reopen"}
                </button>
              </div>
            </div>
          ))}
        </div>
        {selectedIssue && (
          <div className="w-80 border border-border rounded-lg overflow-hidden flex flex-col shrink-0">
            <div className="px-3 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
              <span className="text-xs font-medium">#{selectedIssue.number}</span>
              <button onClick={() => setSelectedIssue(null)}><X size={13} className="text-muted-foreground hover:text-foreground" /></button>
            </div>
            <div className="flex-1 overflow-auto ide-scroll p-3 space-y-3">
              <p className="font-semibold text-sm">{selectedIssue.title}</p>
              {selectedIssue.body && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{selectedIssue.body}</p>}
              <div className="border-t border-border pt-3 space-y-3">
                {issueComments.map((c: any) => (
                  <div key={c.id} className="text-xs">
                    <div className="flex items-center gap-1.5 mb-1"><img src={c.user.avatar_url} className="w-5 h-5 rounded-full" alt="" /><span className="font-medium">@{c.user.login}</span><span className="text-muted-foreground">{timeAgo(c.created_at)}</span></div>
                    <p className="text-muted-foreground whitespace-pre-wrap">{c.body}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-2 border-t border-border flex gap-1.5">
              <Input value={newComment} onChange={e => setNewComment(e.target.value)} placeholder="Leave a comment…" className="text-xs h-8" onKeyDown={e => e.key === "Enter" && postComment()} />
              <Button size="sm" onClick={postComment} className="h-8 shrink-0 text-xs">Post</Button>
            </div>
          </div>
        )}
      </div>
    );

    // ── Pull Requests ──────────────────────────────────────────────────────
    if (tab === "pulls" && selectedRepo) return (
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex gap-1.5">
            {(["open", "closed", "all"] as const).map(s => (
              <Button key={s} size="sm" variant={prState === s ? "default" : "outline"} className="h-7 text-xs capitalize" onClick={() => setPrState(s)}>{s}</Button>
            ))}
          </div>
          <Button size="sm" onClick={() => { setNewPR({ title: "", body: "", head: "", base: selectedRepo.default_branch }); setShowCreatePR(true); }} className="gap-1.5 text-xs h-7"><Plus size={12} />New PR</Button>
        </div>
        {pulls.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">No {prState} pull requests.</p>}
        {pulls.map(pr => (
          <div key={pr.number} className="p-3 rounded-lg border border-border hover:bg-muted/20 transition-colors">
            <div className="flex items-start gap-2">
              <GitPullRequest size={14} className={`mt-0.5 shrink-0 ${pr.state === "open" ? "text-green-400" : "text-purple-400"}`} />
              <div className="flex-1 min-w-0">
                <a href={pr.html_url} target="_blank" rel="noopener" className="text-sm font-medium hover:text-primary line-clamp-1">#{pr.number} {pr.title}</a>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                  <span>@{pr.user.login}</span><span>{timeAgo(pr.created_at)}</span>
                  <span className="font-mono">{pr.head.ref} → {pr.base.ref}</span>
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                {pr.state === "open" && <>
                  <Button size="sm" className="h-7 text-xs gap-1 bg-purple-600 hover:bg-purple-700" onClick={() => mergePR(pr)}><CheckCircle2 size={11} />Merge</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => closePR(pr)}>Close</Button>
                </>}
              </div>
            </div>
          </div>
        ))}
      </div>
    );

    // ── Releases ───────────────────────────────────────────────────────────
    if (tab === "releases" && selectedRepo) return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Releases</h3>
          <Button size="sm" onClick={() => setShowCreateRelease(true)} className="gap-1.5 text-xs"><Plus size={12} />New Release</Button>
        </div>
        {releases.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">No releases yet.</p>}
        {releases.map(r => (
          <div key={r.id} className="p-4 rounded-lg border border-border space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Tag size={14} className="text-muted-foreground" />
              <a href={r.html_url} target="_blank" rel="noopener" className="font-semibold text-sm hover:text-primary">{r.name || r.tag_name}</a>
              <Badge variant="outline" className="text-[10px] h-4">{r.tag_name}</Badge>
              {r.prerelease && <Badge variant="secondary" className="text-[10px] h-4">pre-release</Badge>}
              {r.draft && <Badge variant="secondary" className="text-[10px] h-4">draft</Badge>}
              <span className="text-xs text-muted-foreground ml-auto">{timeAgo(r.created_at)}</span>
            </div>
            {r.body && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{r.body.slice(0, 200)}{r.body.length > 200 ? "…" : ""}</p>}
          </div>
        ))}
      </div>
    );

    // ── Actions ────────────────────────────────────────────────────────────
    if (tab === "actions" && selectedRepo) return (
      <div className="space-y-3">
        <h3 className="font-semibold">Workflow Runs</h3>
        {actions.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">No workflow runs found.</p>}
        {actions.map((run: any) => (
          <div key={run.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
            {run.conclusion === "success" ? <CheckCircle2 size={14} className="text-green-400 shrink-0" />
              : run.conclusion === "failure" ? <XCircle size={14} className="text-red-400 shrink-0" />
              : <Loader2 size={14} className="animate-spin text-yellow-400 shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium line-clamp-1">{run.name}</p>
              <div className="text-xs text-muted-foreground flex gap-2 flex-wrap">
                <span>{run.event}</span><span>{run.head_branch}</span><span>{timeAgo(run.created_at)}</span>
              </div>
            </div>
            <a href={run.html_url} target="_blank" rel="noopener"><ExternalLink size={13} className="text-muted-foreground hover:text-foreground" /></a>
          </div>
        ))}
      </div>
    );

    // ── Gists ──────────────────────────────────────────────────────────────
    if (tab === "gists") return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{gists.length} Gists</h3>
        </div>
        {gists.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">No gists found.</p>}
        {gists.map((g: any) => (
          <div key={g.id} className="p-3 rounded-lg border border-border space-y-1">
            <div className="flex items-center gap-2">
              <FileText size={13} className="text-muted-foreground shrink-0" />
              <a href={g.html_url} target="_blank" rel="noopener" className="text-sm font-medium hover:text-primary truncate">{Object.keys(g.files)[0] ?? "gist"}</a>
              <span className="ml-auto text-xs text-muted-foreground">{timeAgo(g.updated_at)}</span>
            </div>
            {g.description && <p className="text-xs text-muted-foreground">{g.description}</p>}
            <div className="text-xs text-muted-foreground">{Object.keys(g.files).length} file(s)</div>
          </div>
        ))}
      </div>
    );

    // ── Notifications ──────────────────────────────────────────────────────
    if (tab === "notifications") return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Notifications</h3>
          <Button size="sm" variant="outline" onClick={() => ghApi(`${API}/notifications`).then(d => { if (Array.isArray(d)) setNotif(d); })} className="text-xs gap-1.5 h-7"><RefreshCw size={12} />Refresh</Button>
        </div>
        {notifications.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">All caught up! 🎉</p>}
        {notifications.map((n: any) => (
          <div key={n.id} className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-muted/20">
            <Bell size={13} className="text-muted-foreground shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium line-clamp-1">{n.subject?.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{n.repository?.full_name} · {n.subject?.type}</p>
            </div>
            <span className="text-xs text-muted-foreground shrink-0">{timeAgo(n.updated_at)}</span>
          </div>
        ))}
      </div>
    );

    // ── Search ─────────────────────────────────────────────────────────────
    if (tab === "search") return (
      <div className="space-y-4">
        <div className="flex gap-2 flex-wrap">
          <Select value={searchType} onValueChange={(v: any) => setSearchType(v)}>
            <SelectTrigger className="w-36 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="repositories">Repositories</SelectItem>
              <SelectItem value="users">Users</SelectItem>
              <SelectItem value="code">Code</SelectItem>
              <SelectItem value="issues">Issues</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex flex-1 gap-2">
            <Input placeholder="Search GitHub…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && doSearch()} className="flex-1" />
            <Button onClick={doSearch} className="gap-1.5 text-sm"><Search size={14} />Search</Button>
          </div>
        </div>
        <div className="space-y-3">
          {searchResults.map((item: any, i) => (
            <div key={item.id ?? i} className="p-3 rounded-lg border border-border hover:bg-muted/20">
              {searchType === "repositories" && (
                <div>
                  <div className="flex items-center gap-2">
                    <img src={item.owner?.avatar_url} className="w-5 h-5 rounded-full" alt="" />
                    <a href={item.html_url} target="_blank" rel="noopener" className="font-medium text-sm hover:text-primary">{item.full_name}</a>
                    <Badge variant={item.private ? "secondary" : "outline"} className="text-[10px] h-4">{item.private ? "Private" : "Public"}</Badge>
                    <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"><Star size={11} />{item.stargazers_count?.toLocaleString()}</span>
                  </div>
                  {item.description && <p className="text-xs text-muted-foreground mt-1">{item.description}</p>}
                  {item.language && <p className="text-xs text-muted-foreground mt-1 flex items-center"><LangDot lang={item.language} />{item.language}</p>}
                </div>
              )}
              {searchType === "users" && (
                <div className="flex items-center gap-3">
                  <img src={item.avatar_url} className="w-9 h-9 rounded-full" alt="" />
                  <div>
                    <a href={item.html_url} target="_blank" rel="noopener" className="font-medium text-sm hover:text-primary">{item.login}</a>
                    <p className="text-xs text-muted-foreground capitalize">{item.type}</p>
                  </div>
                </div>
              )}
              {searchType === "code" && (
                <div>
                  <a href={item.html_url} target="_blank" rel="noopener" className="text-sm font-medium hover:text-primary">{item.repository?.full_name}/{item.path}</a>
                </div>
              )}
              {searchType === "issues" && (
                <div>
                  <div className="flex items-center gap-2">
                    <AlertCircle size={13} className={item.state === "open" ? "text-green-400" : "text-red-400"} />
                    <a href={item.html_url} target="_blank" rel="noopener" className="text-sm font-medium hover:text-primary">{item.title}</a>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{item.repository_url?.replace("https://api.github.com/repos/", "")} · #{item.number}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );

    return null;
  }

  // ── Full Render ────────────────────────────────────────────────────────────

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-foreground flex items-center justify-center">
              <Github size={22} className="text-background" />
            </div>
            <div>
              <h1 className="text-xl font-bold">GitHub</h1>
              {user && <p className="text-xs text-muted-foreground">@{user.login}</p>}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {selectedRepo && (
              <>
                <Button size="sm" variant="outline" onClick={openEditRepo} className="gap-1.5 text-xs"><Settings2 size={12} />Edit Repo</Button>
                <Button size="sm" variant="outline" onClick={openImportRepo} className="gap-1.5 text-xs"><FolderDown size={12} />Import to IDE</Button>
                <Button size="sm" variant="outline" onClick={forkRepo} className="gap-1.5 text-xs"><GitFork size={12} />Fork</Button>
                <Button size="sm" variant="outline" onClick={openPushProject} className="gap-1.5 text-xs"><Upload size={12} />Push Project</Button>
                <a href={selectedRepo.html_url} target="_blank" rel="noopener">
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs"><ExternalLink size={12} />Open on GitHub</Button>
                </a>
              </>
            )}
          </div>
        </div>

        {/* Selected repo indicator */}
        {selectedRepo && (
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border border-border rounded-lg text-sm flex-wrap">
            <img src={selectedRepo.owner.avatar_url} className="w-5 h-5 rounded-full" alt="" />
            <span className="font-medium">{selectedRepo.full_name}</span>
            <Badge variant={selectedRepo.private ? "secondary" : "outline"} className="text-[10px] h-4">{selectedRepo.private ? "Private" : "Public"}</Badge>
            {selectedRepo.language && <span className="flex items-center text-xs text-muted-foreground"><LangDot lang={selectedRepo.language} />{selectedRepo.language}</span>}
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><Star size={11} />{selectedRepo.stargazers_count}</span>
            <button onClick={() => setSelectedRepo(null)} className="ml-auto text-muted-foreground hover:text-foreground"><X size={14} /></button>
          </div>
        )}

        {/* Tab bar — outer div handles sticky, inner div handles horizontal scroll */}
        <div className="sticky top-0 z-20 bg-background -mx-4 md:-mx-6 border-b border-border">
          <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
            <div className="flex gap-0.5 px-4 md:px-6 min-w-max">
              {activeTabs.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40"
                  }`}
                >
                  <Icon size={12} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Tab body */}
        <div key={tab} className="min-h-[400px] animate-in fade-in duration-150">
          {renderTabContent()}
        </div>
      </div>

      {/* ── Dialogs ─────────────────────────────────────────────────────────── */}

      {/* Create Repo */}
      <Dialog open={showCreateRepo} onOpenChange={setShowCreateRepo}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Repository</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5"><label className="text-sm font-medium">Name *</label><Input placeholder="my-project" value={newRepo.name} onChange={e => setNewRepo(r => ({ ...r, name: e.target.value }))} /></div>
            <div className="space-y-1.5"><label className="text-sm font-medium">Description</label><Input placeholder="Optional description" value={newRepo.description} onChange={e => setNewRepo(r => ({ ...r, description: e.target.value }))} /></div>
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={newRepo.private} onChange={e => setNewRepo(r => ({ ...r, private: e.target.checked }))} className="rounded" />
                <Lock size={13} /> Private
              </label>
              <label className="text-sm font-medium flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={newRepo.auto_init} onChange={e => setNewRepo(r => ({ ...r, auto_init: e.target.checked }))} className="rounded" />
                Initialize with README
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateRepo(false)}>Cancel</Button>
            <Button onClick={createRepo} disabled={!newRepo.name.trim()}>Create Repository</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Branch */}
      <Dialog open={showCreateBranch} onOpenChange={setShowCreateBranch}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Branch</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5"><label className="text-sm font-medium">Branch name *</label><Input placeholder="feature/my-feature" value={newBranch.name} onChange={e => setNewBranch(b => ({ ...b, name: e.target.value }))} /></div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">From branch</label>
              <Select value={newBranch.from} onValueChange={v => setNewBranch(b => ({ ...b, from: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{branches.map(b => <SelectItem key={b.name} value={b.name}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateBranch(false)}>Cancel</Button>
            <Button onClick={createBranch} disabled={!newBranch.name.trim()}>Create Branch</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Issue */}
      <Dialog open={showCreateIssue} onOpenChange={setShowCreateIssue}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Issue</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5"><label className="text-sm font-medium">Title *</label><Input placeholder="Bug: something is broken" value={newIssue.title} onChange={e => setNewIssue(i => ({ ...i, title: e.target.value }))} /></div>
            <div className="space-y-1.5"><label className="text-sm font-medium">Description</label><textarea className="w-full h-28 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none" placeholder="Describe the issue…" value={newIssue.body} onChange={e => setNewIssue(i => ({ ...i, body: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateIssue(false)}>Cancel</Button>
            <Button onClick={createIssue} disabled={!newIssue.title.trim()}>Create Issue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create PR */}
      <Dialog open={showCreatePR} onOpenChange={setShowCreatePR}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Pull Request</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5"><label className="text-sm font-medium">Title *</label><Input placeholder="feat: add dark mode" value={newPR.title} onChange={e => setNewPR(p => ({ ...p, title: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">From (head)</label>
                <Select value={newPR.head} onValueChange={v => setNewPR(p => ({ ...p, head: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                  <SelectContent>{branches.filter(b => b.name !== newPR.base).map(b => <SelectItem key={b.name} value={b.name}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Into (base)</label>
                <Select value={newPR.base} onValueChange={v => setNewPR(p => ({ ...p, base: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                  <SelectContent>{branches.map(b => <SelectItem key={b.name} value={b.name}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5"><label className="text-sm font-medium">Description</label><textarea className="w-full h-24 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none" placeholder="What does this PR do?" value={newPR.body} onChange={e => setNewPR(p => ({ ...p, body: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreatePR(false)}>Cancel</Button>
            <Button onClick={createPR} disabled={!newPR.title.trim() || !newPR.head || !newPR.base}>Create Pull Request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Release */}
      <Dialog open={showCreateRelease} onOpenChange={setShowCreateRelease}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Release</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5"><label className="text-sm font-medium">Tag *</label><Input placeholder="v1.0.0" value={newRelease.tag_name} onChange={e => setNewRelease(r => ({ ...r, tag_name: e.target.value }))} /></div>
            <div className="space-y-1.5"><label className="text-sm font-medium">Release title</label><Input placeholder="Version 1.0.0" value={newRelease.name} onChange={e => setNewRelease(r => ({ ...r, name: e.target.value }))} /></div>
            <div className="space-y-1.5"><label className="text-sm font-medium">Release notes</label><textarea className="w-full h-24 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none" placeholder="What's new in this release?" value={newRelease.body} onChange={e => setNewRelease(r => ({ ...r, body: e.target.value }))} /></div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={newRelease.prerelease} onChange={e => setNewRelease(r => ({ ...r, prerelease: e.target.checked }))} />Pre-release</label>
              <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={newRelease.draft} onChange={e => setNewRelease(r => ({ ...r, draft: e.target.checked }))} />Draft</label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateRelease(false)}>Cancel</Button>
            <Button onClick={createRelease} disabled={!newRelease.tag_name.trim()}>Publish Release</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Repo ─── */}
      <Dialog open={showEditRepo} onOpenChange={setShowEditRepo}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Settings2 size={16} />Edit Repository</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Repository name</label>
              <Input value={editRepoForm.name} onChange={e => setEditRepoForm(f => ({ ...f, name: e.target.value }))} placeholder="repo-name" className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <Input value={editRepoForm.description} onChange={e => setEditRepoForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Website / Homepage</label>
              <Input value={editRepoForm.homepage} onChange={e => setEditRepoForm(f => ({ ...f, homepage: e.target.value }))} placeholder="https://example.com" />
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={editRepoForm.private} onChange={e => setEditRepoForm(f => ({ ...f, private: e.target.checked }))} className="rounded" />
                <Lock size={13} /> Private repository
              </label>
              <p className="text-xs text-muted-foreground ml-auto">{editRepoForm.private ? "Only you can access" : "Anyone can view"}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditRepo(false)}>Cancel</Button>
            <Button onClick={updateRepo} disabled={!editRepoForm.name.trim()} className="gap-1.5"><CheckCheck size={14} />Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Import Repo to CloudIDE ─── */}
      <Dialog open={showImportRepo} onOpenChange={v => { if (!importLoading) setShowImportRepo(v); }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><FolderDown size={16} />Import to CloudIDE</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <img src={selectedRepo?.owner.avatar_url} className="w-8 h-8 rounded-full shrink-0 mt-0.5" alt="" />
              <div>
                <p className="text-sm font-semibold">{selectedRepo?.full_name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{selectedRepo?.description || "No description"}</p>
                <div className="flex gap-3 mt-1.5 text-xs text-muted-foreground">
                  {selectedRepo?.language && <span className="flex items-center"><LangDot lang={selectedRepo.language} />{selectedRepo.language}</span>}
                  <span className="flex items-center gap-0.5"><Star size={11} />{selectedRepo?.stargazers_count}</span>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Project name in CloudIDE</label>
              <Input value={importProjectName} onChange={e => setImportProjectName(e.target.value)} placeholder="my-project" className="font-mono" disabled={importLoading} />
            </div>
            {importLoading && (
              <div className="flex items-center gap-2 p-3 bg-muted/40 rounded-lg border border-border">
                <Loader2 size={14} className="animate-spin text-primary shrink-0" />
                <p className="text-xs text-muted-foreground">{importProgress}</p>
              </div>
            )}
            {!importLoading && (
              <p className="text-xs text-muted-foreground">Up to 50 text files will be imported. Binary files are skipped automatically.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportRepo(false)} disabled={importLoading}>Cancel</Button>
            <Button onClick={importToCloudIDE} disabled={importLoading || !importProjectName.trim()} className="gap-1.5">
              {importLoading ? <Loader2 size={14} className="animate-spin" /> : <FolderDown size={14} />}
              {importLoading ? "Importing…" : "Import Repository"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Push Project to GitHub ─── */}
      <Dialog open={showPushProject} onOpenChange={v => { if (!pushLoading) setShowPushProject(v); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Upload size={16} />Push Project to GitHub</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">Push a CloudIDE project's files to <strong>{selectedRepo?.full_name}</strong>.</p>

            {/* Project selector */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Select CloudIDE project</label>
              {localProjects.length === 0 ? (
                <p className="text-xs text-muted-foreground p-2 bg-muted/30 rounded">No projects found. Create one first.</p>
              ) : (
                <Select value={pushProjectId ? String(pushProjectId) : ""} onValueChange={v => setPushProjectId(Number(v))}>
                  <SelectTrigger><SelectValue placeholder="Choose a project…" /></SelectTrigger>
                  <SelectContent>
                    {localProjects.map((p: any) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Branch</label>
                <Input value={pushBranch} onChange={e => setPushBranch(e.target.value)} placeholder="main" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Commit message</label>
                <Input value={pushMsg} onChange={e => setPushMsg(e.target.value)} />
              </div>
            </div>

            {/* Push results */}
            {pushResults && (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="px-3 py-2 bg-muted/30 border-b border-border text-xs font-medium">Push Results</div>
                <div className="divide-y divide-border max-h-40 overflow-auto">
                  {pushResults.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 text-xs">
                      {r.status === "error"
                        ? <XCircle size={12} className="text-red-400 shrink-0" />
                        : <CheckCircle2 size={12} className="text-green-400 shrink-0" />}
                      <span className="font-mono flex-1 truncate">{r.name}</span>
                      <span className={`capitalize ${r.status === "error" ? "text-red-400" : "text-green-400"}`}>{r.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowPushProject(false); setPushResults(null); }} disabled={pushLoading}>
              {pushResults ? "Done" : "Cancel"}
            </Button>
            {!pushResults && (
              <Button onClick={doPushProject} disabled={pushLoading || !pushProjectId} className="gap-1.5">
                {pushLoading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {pushLoading ? "Pushing…" : "Push to GitHub"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

// ── Folder icon (missing from main import) ────────────────────────────────────
function Folder({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}
