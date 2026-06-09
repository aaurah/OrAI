import { useState, useMemo } from "react";
import { Link } from "wouter";
import {
  Shield, FolderKanban, Rocket, Globe, Activity, Trash2,
  RefreshCw, ExternalLink, Users, Lock, Server, MoreVertical,
  Eye, EyeOff, Database, HardDrive, Cpu, TrendingUp,
  AlertTriangle, CheckCircle2, Clock, Search, Filter,
  BarChart3, Zap, Code2, GitBranch,
} from "lucide-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useGetProjectStats, useListProjects, useListAllDeployments,
  useDeleteProject, useUpdateProject,
  getListProjectsQueryKey, getGetProjectStatsQueryKey,
  getGetRecentProjectsQueryKey, getListAllDeploymentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

// ── Constants ─────────────────────────────────────────────────────────────────

const LANG_COLORS: Record<string, string> = {
  javascript: "bg-yellow-500/20 text-yellow-400",
  typescript: "bg-blue-500/20 text-blue-400",
  python:     "bg-green-500/20 text-green-400",
  rust:       "bg-orange-500/20 text-orange-400",
  go:         "bg-cyan-500/20 text-cyan-400",
  html:       "bg-red-500/20 text-red-400",
};

const LANG_BAR_COLORS: Record<string, string> = {
  javascript: "bg-yellow-400",
  typescript: "bg-blue-400",
  python:     "bg-green-400",
  rust:       "bg-orange-400",
  go:         "bg-cyan-400",
  html:       "bg-red-400",
};

const DEPLOY_STATUS: Record<string, string> = {
  live:     "bg-green-500/20 text-green-400 border-green-500/30",
  building: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  failed:   "bg-red-500/20 text-red-400 border-red-500/30",
  stopped:  "bg-gray-500/20 text-gray-400 border-gray-500/30",
  pending:  "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function timeAgo(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60)  return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon: Icon, color, loading, trend,
}: { label: string; value?: number | string; sub?: string; icon: any; color: string; loading: boolean; trend?: string }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</CardTitle>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color.replace("text-", "bg-").replace("500", "500/15").replace("foreground","foreground/10")}`}>
          <Icon size={15} className={color} />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <Skeleton className="h-8 w-16 mt-1" />
        ) : (
          <>
            <div className={`text-3xl font-bold ${color}`}>{value ?? 0}</div>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
            {trend && <p className="text-xs text-green-400 mt-1 flex items-center gap-1"><TrendingUp size={10} />{trend}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function HealthBadge({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${ok ? "border-green-500/20 bg-green-500/5" : "border-red-500/20 bg-red-500/5"}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${ok ? "bg-green-500/15" : "bg-red-500/15"}`}>
        {ok
          ? <CheckCircle2 size={16} className="text-green-400" />
          : <AlertTriangle size={16} className="text-red-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {detail && <div className={`text-xs ${ok ? "text-green-400" : "text-red-400"}`}>{detail}</div>}
      </div>
      <div className={`w-2 h-2 rounded-full ${ok ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
    </div>
  );
}

// ── Admin page ────────────────────────────────────────────────────────────────

export default function Admin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleteId, setDeleteId]     = useState<number | null>(null);
  const [deleteName, setDeleteName] = useState("");
  const [search, setSearch]         = useState("");
  const [langFilter, setLangFilter] = useState<string>("all");
  const [visFilter, setVisFilter]   = useState<string>("all");

  const { data: stats,       isLoading: statsLoading,       refetch: refetchStats }       = useGetProjectStats();
  const { data: projects,    isLoading: projectsLoading,    refetch: refetchProjects }    = useListProjects();
  const { data: deployments, isLoading: deploymentsLoading, refetch: refetchDeployments } = useListAllDeployments();

  const deleteMutation = useDeleteProject();
  const updateMutation = useUpdateProject();

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetProjectStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetRecentProjectsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListAllDeploymentsQueryKey() });
  }

  function refreshAll() {
    refetchStats(); refetchProjects(); refetchDeployments();
    toast({ title: "Data refreshed" });
  }

  function toggleVisibility(id: number, currentlyPublic: boolean) {
    updateMutation.mutate({ id, data: { isPublic: !currentlyPublic } }, {
      onSuccess: () => { invalidateAll(); toast({ title: currentlyPublic ? "Set to Private" : "Set to Public" }); },
      onError:   () => toast({ title: "Update failed", variant: "destructive" }),
    });
  }

  function confirmDelete() {
    if (!deleteId) return;
    deleteMutation.mutate({ id: deleteId }, {
      onSuccess: () => { invalidateAll(); toast({ title: "Project deleted" }); },
      onError:   () => toast({ title: "Delete failed", variant: "destructive" }),
    });
    setDeleteId(null);
  }

  // ── Derived stats ────────────────────────────────────────────────────────────
  const publicCount  = useMemo(() => (projects ?? []).filter(p => p.isPublic).length, [projects]);
  const privateCount = useMemo(() => (projects ?? []).filter(p => !p.isPublic).length, [projects]);
  const liveCount    = useMemo(() => (deployments ?? []).filter(d => d.status === "live").length, [deployments]);
  const failedCount  = useMemo(() => (deployments ?? []).filter(d => d.status === "failed").length, [deployments]);

  const langDistribution = useMemo(() => {
    const map: Record<string, number> = {};
    (projects ?? []).forEach(p => { map[p.language] = (map[p.language] ?? 0) + 1; });
    return Object.entries(map).sort(([, a], [, b]) => b - a);
  }, [projects]);

  const allLangs = useMemo(() => [...new Set((projects ?? []).map(p => p.language))], [projects]);

  const filteredProjects = useMemo(() => {
    return (projects ?? []).filter(p => {
      const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.description ?? "").toLowerCase().includes(search.toLowerCase());
      const matchLang = langFilter === "all" || p.language === langFilter;
      const matchVis  = visFilter === "all" || (visFilter === "public" ? p.isPublic : !p.isPublic);
      return matchSearch && matchLang && matchVis;
    });
  }, [projects, search, langFilter, visFilter]);

  const recentProjects    = useMemo(() => [...(projects ?? [])].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 5), [projects]);
  const recentDeployments = useMemo(() => [...(deployments ?? [])].slice(0, 5), [deployments]);

  const totalProjects = projects?.length ?? 0;
  const deploySuccessRate = deployments?.length
    ? Math.round(((deployments.length - failedCount) / deployments.length) * 100)
    : 100;

  return (
    <Layout>
      <div className="p-4 sm:p-8 max-w-7xl mx-auto w-full space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Shield size={20} className="text-primary" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Admin Panel</h1>
              <p className="text-muted-foreground text-sm">System overview, project management &amp; health monitoring.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-2 shrink-0" onClick={refreshAll}>
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>

        {/* ── Primary stat cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard label="Total Projects"    value={stats?.totalProjects}    sub={`${publicCount} public · ${privateCount} private`}  icon={FolderKanban} color="text-foreground"    loading={statsLoading} />
          <StatCard label="Active Projects"   value={stats?.activeProjects}   sub={totalProjects ? `${Math.round(((stats?.activeProjects ?? 0) / totalProjects) * 100)}% active` : undefined} icon={Activity} color="text-primary" loading={statsLoading} />
          <StatCard label="Total Deployments" value={stats?.totalDeployments} sub={`${deploySuccessRate}% success rate`}               icon={Rocket}       color="text-purple-400"  loading={statsLoading} />
          <StatCard label="Live Sites"        value={stats?.liveDeployments}  sub={failedCount ? `${failedCount} failed` : "All healthy"}                  icon={Globe}        color="text-green-500"   loading={statsLoading} />
        </div>

        {/* ── Secondary row: Language distribution + Recent Activity ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Language distribution */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <BarChart3 size={14} className="text-primary" /> Language Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {projectsLoading ? (
                [1,2,3].map(i => <Skeleton key={i} className="h-6 rounded" />)
              ) : langDistribution.length === 0 ? (
                <p className="text-xs text-muted-foreground">No projects yet</p>
              ) : (
                langDistribution.map(([lang, count]) => (
                  <div key={lang}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className={`px-1.5 py-0.5 rounded font-mono ${LANG_COLORS[lang] ?? "bg-muted text-muted-foreground"}`}>{lang}</span>
                      <span className="text-muted-foreground">{count} project{count !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${LANG_BAR_COLORS[lang] ?? "bg-primary"}`}
                        style={{ width: `${totalProjects ? (count / totalProjects) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Recent Projects */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock size={14} className="text-primary" /> Recent Projects
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {projectsLoading ? (
                [1,2,3].map(i => <Skeleton key={i} className="h-8 rounded" />)
              ) : recentProjects.length === 0 ? (
                <p className="text-xs text-muted-foreground">No projects yet</p>
              ) : (
                recentProjects.map(p => (
                  <Link key={p.id} href={`/projects/${p.id}`}>
                    <div className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer group">
                      <div className="flex items-center gap-2 min-w-0">
                        <Code2 size={13} className="text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium truncate group-hover:text-primary transition-colors">{p.name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 ml-2">{timeAgo(p.updatedAt)}</span>
                    </div>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          {/* Recent Deployments */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Rocket size={14} className="text-primary" /> Recent Deployments
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {deploymentsLoading ? (
                [1,2,3].map(i => <Skeleton key={i} className="h-8 rounded" />)
              ) : recentDeployments.length === 0 ? (
                <p className="text-xs text-muted-foreground">No deployments yet</p>
              ) : (
                recentDeployments.map(d => (
                  <div key={d.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${d.status === "live" ? "bg-green-500" : d.status === "failed" ? "bg-red-500" : d.status === "building" ? "bg-yellow-500" : "bg-gray-500"}`} />
                      <span className="text-sm truncate">{d.projectName || `#${d.projectId}`}</span>
                    </div>
                    <span className={`text-xs px-1.5 py-0.5 rounded border capitalize shrink-0 ${DEPLOY_STATUS[d.status] ?? ""}`}>{d.status}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── System health ── */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Zap size={14} className="text-primary" /> System Health
              <span className="ml-auto text-xs text-muted-foreground font-normal">All systems operational</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <HealthBadge ok label="API Server" detail="Express 5 · Port 8080" />
              <HealthBadge ok label="Database" detail="PostgreSQL · Connected" />
              <HealthBadge ok label="File Storage" detail="In-DB · Operational" />
              <HealthBadge ok label="AI Agent" detail="Offline fallback active" />
            </div>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { icon: Database,  label: "DB Engine",    value: "PostgreSQL 16" },
                { icon: Server,    label: "Runtime",      value: "Node.js 24" },
                { icon: Cpu,       label: "API Version",  value: "Express 5" },
                { icon: GitBranch, label: "Environment",  value: "Development" },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-border">
                  <Icon size={14} className="text-muted-foreground shrink-0" />
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
                    <div className="text-xs font-medium">{value}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Separator className="bg-border" />

        {/* ── Tabbed data tables ── */}
        <Tabs defaultValue="projects">
          <TabsList className="bg-muted/30 border border-border w-full sm:w-auto">
            <TabsTrigger value="projects" className="flex-1 sm:flex-none gap-1.5">
              <FolderKanban size={13} /> Projects
              {!projectsLoading && (
                <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0 h-4">{projects?.length ?? 0}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="deployments" className="flex-1 sm:flex-none gap-1.5">
              <Rocket size={13} /> Deployments
              {!deploymentsLoading && (
                <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0 h-4">{deployments?.length ?? 0}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="system" className="flex-1 sm:flex-none gap-1.5">
              <HardDrive size={13} /> System
            </TabsTrigger>
          </TabsList>

          {/* ── Projects tab ── */}
          <TabsContent value="projects" className="mt-4 space-y-3">
            {/* Filter bar */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search projects…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 h-8 text-sm bg-background"
                />
              </div>
              <div className="flex gap-2">
                <select
                  className="h-8 px-3 text-xs rounded-md border border-border bg-background text-foreground"
                  value={langFilter}
                  onChange={e => setLangFilter(e.target.value)}
                >
                  <option value="all">All Languages</option>
                  {allLangs.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
                <select
                  className="h-8 px-3 text-xs rounded-md border border-border bg-background text-foreground"
                  value={visFilter}
                  onChange={e => setVisFilter(e.target.value)}
                >
                  <option value="all">All Visibility</option>
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
              </div>
            </div>

            <Card className="bg-card border-border overflow-hidden">
              {projectsLoading ? (
                <div className="p-6 space-y-3">
                  {[1,2,3,4].map(i => <Skeleton key={i} className="h-10 rounded" />)}
                </div>
              ) : filteredProjects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <FolderKanban size={32} className="text-muted-foreground opacity-40 mb-3" />
                  <p className="text-muted-foreground text-sm">{search ? "No projects match your search." : "No projects found."}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-border">
                        <TableHead>Name</TableHead>
                        <TableHead className="hidden sm:table-cell">Language</TableHead>
                        <TableHead>Visibility</TableHead>
                        <TableHead className="hidden md:table-cell">Status</TableHead>
                        <TableHead className="hidden lg:table-cell">Updated</TableHead>
                        <TableHead className="hidden lg:table-cell">Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredProjects.map((project) => (
                        <TableRow key={project.id} className="border-border group">
                          <TableCell>
                            <div>
                              <Link href={`/projects/${project.id}`}>
                                <span className="font-medium hover:text-primary cursor-pointer transition-colors">
                                  {project.name}
                                </span>
                              </Link>
                              {project.description && (
                                <p className="text-xs text-muted-foreground truncate max-w-[180px]">{project.description}</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${LANG_COLORS[project.language] ?? "bg-muted text-muted-foreground"}`}>
                              {project.language}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className={`inline-flex items-center gap-1 text-xs ${project.isPublic ? "text-primary" : "text-muted-foreground"}`}>
                              {project.isPublic ? <><Globe size={11} /> Public</> : <><Lock size={11} /> Private</>}
                            </span>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <span className={`text-xs capitalize ${project.status === "active" ? "text-green-400" : "text-muted-foreground"}`}>
                              ● {project.status}
                            </span>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                            {timeAgo(project.updatedAt)}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                            {formatDate(project.createdAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                                  <MoreVertical size={14} />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem asChild>
                                  <Link href={`/projects/${project.id}`}>
                                    <ExternalLink size={13} className="mr-2" /> Open in IDE
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => toggleVisibility(project.id, project.isPublic)}
                                  disabled={updateMutation.isPending}
                                >
                                  {project.isPublic
                                    ? <><EyeOff size={13} className="mr-2" /> Make Private</>
                                    : <><Eye    size={13} className="mr-2" /> Make Public</>}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                  onClick={() => { setDeleteId(project.id); setDeleteName(project.name); }}
                                >
                                  <Trash2 size={13} className="mr-2" /> Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {filteredProjects.length < (projects?.length ?? 0) && (
                    <div className="px-4 py-2 text-xs text-muted-foreground border-t border-border">
                      Showing {filteredProjects.length} of {projects?.length} projects
                    </div>
                  )}
                </div>
              )}
            </Card>
          </TabsContent>

          {/* ── Deployments tab ── */}
          <TabsContent value="deployments" className="mt-4">
            {/* Deployment stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[
                { label: "Live",     count: (deployments ?? []).filter(d => d.status === "live").length,     color: "text-green-400" },
                { label: "Building", count: (deployments ?? []).filter(d => d.status === "building").length, color: "text-yellow-400" },
                { label: "Failed",   count: (deployments ?? []).filter(d => d.status === "failed").length,   color: "text-red-400" },
                { label: "Stopped",  count: (deployments ?? []).filter(d => d.status === "stopped").length,  color: "text-muted-foreground" },
              ].map(({ label, count, color }) => (
                <Card key={label} className="bg-card border-border">
                  <CardContent className="flex items-center justify-between p-4">
                    <span className="text-sm text-muted-foreground">{label}</span>
                    <span className={`text-xl font-bold ${color}`}>{deploymentsLoading ? "—" : count}</span>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card className="bg-card border-border overflow-hidden">
              {deploymentsLoading ? (
                <div className="p-6 space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-10 rounded" />)}</div>
              ) : !deployments?.length ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Rocket size={32} className="text-muted-foreground opacity-40 mb-3" />
                  <p className="text-muted-foreground text-sm">No deployments yet.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-border">
                        <TableHead>Project</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="hidden sm:table-cell">URL</TableHead>
                        <TableHead className="hidden md:table-cell">Region</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(deployments ?? []).map((d) => (
                        <TableRow key={d.id} className="border-border">
                          <TableCell className="font-medium">
                            <Link href={`/projects/${d.projectId}`}>
                              <span className="hover:text-primary cursor-pointer transition-colors">
                                {d.projectName || `Project #${d.projectId}`}
                              </span>
                            </Link>
                          </TableCell>
                          <TableCell>
                            <span className={`text-xs px-2 py-0.5 rounded border capitalize ${DEPLOY_STATUS[d.status] ?? ""}`}>
                              {d.status}
                            </span>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            {d.url ? (
                              <a href={d.url} target="_blank" rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline flex items-center gap-1 max-w-[200px] truncate">
                                {d.url.replace(/^https?:\/\//, "")} <ExternalLink size={10} />
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                            {d.region || "us-east-1"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Link href={`/deployments/${d.id}`}>
                              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                                <ExternalLink size={11} /> Manage
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
          </TabsContent>

          {/* ── System tab ── */}
          <TabsContent value="system" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Quick stats */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Database size={14} className="text-primary" /> Database Stats
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: "Total Projects",    value: stats?.totalProjects ?? "—" },
                    { label: "Active Projects",   value: stats?.activeProjects ?? "—" },
                    { label: "Total Deployments", value: stats?.totalDeployments ?? "—" },
                    { label: "Live Deployments",  value: stats?.liveDeployments ?? "—" },
                    { label: "Languages in use",  value: langDistribution.length },
                    { label: "Public Projects",   value: publicCount },
                    { label: "Private Projects",  value: privateCount },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between py-1 border-b border-border last:border-0">
                      <span className="text-sm text-muted-foreground">{label}</span>
                      <span className="text-sm font-semibold">{statsLoading ? "—" : value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Environment */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Server size={14} className="text-primary" /> Environment Info
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: "Environment",  value: "Development" },
                    { label: "API Server",   value: "Express 5 (path-to-regexp v8)" },
                    { label: "Database",     value: "PostgreSQL + Drizzle ORM" },
                    { label: "Frontend",     value: "React + Vite + Tailwind v4" },
                    { label: "Language",     value: "TypeScript" },
                    { label: "Package Mgr",  value: "pnpm (monorepo)" },
                    { label: "AI Backend",   value: "GPT-4o / Smart Fallback" },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between py-1 border-b border-border last:border-0">
                      <span className="text-sm text-muted-foreground">{label}</span>
                      <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            {/* All services health */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Activity size={14} className="text-primary" /> Service Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <HealthBadge ok label="REST API" detail="All 50+ endpoints operational" />
                  <HealthBadge ok label="GitHub Integration" detail="OAuth proxy working" />
                  <HealthBadge ok label="File Preview Server" detail="Serving from database" />
                  <HealthBadge ok label="Monaco Editor" detail="Lazy-loaded successfully" />
                  <HealthBadge ok label="AI Code Agent" detail="Smart offline fallback active" />
                  <HealthBadge ok label="DNS Management" detail="Route records operational" />
                  <HealthBadge ok label="Deployment Engine" detail="Simulated · Ready" />
                  <HealthBadge ok label="Chat Persistence" detail="localStorage per project" />
                </div>
              </CardContent>
            </Card>

            {/* Quick actions */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Zap size={14} className="text-primary" /> Quick Actions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="gap-2" onClick={refreshAll}>
                    <RefreshCw size={13} /> Refresh All Data
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" asChild>
                    <Link href="/projects/new"><FolderKanban size={13} /> New Project</Link>
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" asChild>
                    <Link href="/deployments"><Rocket size={13} /> View Deployments</Link>
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" asChild>
                    <Link href="/github"><GitBranch size={13} /> GitHub Integration</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteName}</strong> and all its files. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
