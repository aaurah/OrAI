import { useState } from "react";
import { Link } from "wouter";
import {
  Shield, FolderKanban, Rocket, Globe, Activity, Trash2,
  RefreshCw, ExternalLink, Users, Lock, Server, MoreVertical, Eye, EyeOff,
} from "lucide-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  useGetProjectStats,
  useListProjects,
  useListAllDeployments,
  useDeleteProject,
  useUpdateProject,
  getListProjectsQueryKey,
  getGetProjectStatsQueryKey,
  getGetRecentProjectsQueryKey,
  getListAllDeploymentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const LANG_COLORS: Record<string, string> = {
  javascript: "bg-yellow-500/20 text-yellow-400",
  typescript: "bg-blue-500/20 text-blue-400",
  python:     "bg-green-500/20 text-green-400",
  rust:       "bg-orange-500/20 text-orange-400",
  go:         "bg-cyan-500/20 text-cyan-400",
  html:       "bg-red-500/20 text-red-400",
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

function StatCard({
  label, value, icon: Icon, color, loading,
}: { label: string; value?: number; icon: any; color: string; loading: boolean }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon size={16} className={color} />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className={`text-3xl font-bold ${color}`}>{value ?? 0}</div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Admin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleteName, setDeleteName] = useState("");

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useGetProjectStats();
  const { data: projects, isLoading: projectsLoading, refetch: refetchProjects } = useListProjects();
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
    refetchStats();
    refetchProjects();
    refetchDeployments();
    toast({ title: "Data refreshed" });
  }

  function toggleVisibility(id: number, currentlyPublic: boolean) {
    updateMutation.mutate({ id, data: { isPublic: !currentlyPublic } }, {
      onSuccess: () => {
        invalidateAll();
        toast({ title: currentlyPublic ? "Set to Private" : "Set to Public" });
      },
      onError: () => toast({ title: "Update failed", variant: "destructive" }),
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

  const publicCount  = (projects ?? []).filter(p => p.isPublic).length;
  const privateCount = (projects ?? []).filter(p => !p.isPublic).length;
  const liveCount    = (deployments ?? []).filter(d => d.status === "live").length;

  return (
    <Layout>
      <div className="p-4 sm:p-8 max-w-7xl mx-auto w-full space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Shield size={18} className="text-primary" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Admin Panel</h1>
              <p className="text-muted-foreground text-sm">Manage all projects, deployments and system health.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-2 shrink-0" onClick={refreshAll}>
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard label="Total Projects"    value={stats?.totalProjects}     icon={FolderKanban} color="text-foreground"    loading={statsLoading} />
          <StatCard label="Active Projects"   value={stats?.activeProjects}    icon={Activity}     color="text-primary"       loading={statsLoading} />
          <StatCard label="Total Deployments" value={stats?.totalDeployments}  icon={Rocket}       color="text-muted-foreground" loading={statsLoading} />
          <StatCard label="Live Sites"        value={stats?.liveDeployments}   icon={Globe}        color="text-green-500"     loading={statsLoading} />
        </div>

        {/* Secondary stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="bg-card border-border">
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-2 text-sm">
                <Globe size={14} className="text-primary" />
                <span className="text-muted-foreground">Public projects</span>
              </div>
              <span className="font-bold text-lg">{projectsLoading ? "—" : publicCount}</span>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-2 text-sm">
                <Lock size={14} className="text-muted-foreground" />
                <span className="text-muted-foreground">Private projects</span>
              </div>
              <span className="font-bold text-lg">{projectsLoading ? "—" : privateCount}</span>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-2 text-sm">
                <Server size={14} className="text-green-500" />
                <span className="text-muted-foreground">Live deployments</span>
              </div>
              <span className="font-bold text-lg text-green-500">{deploymentsLoading ? "—" : liveCount}</span>
            </CardContent>
          </Card>
        </div>

        {/* System health */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              System Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              {[
                { label: "API Server",   status: "Operational", ok: true  },
                { label: "Database",     status: "Operational", ok: true  },
                { label: "File Storage", status: "Operational", ok: true  },
                { label: "DNS Service",  status: "Operational", ok: true  },
              ].map(({ label, status, ok }) => (
                <div key={label} className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${ok ? "bg-green-500" : "bg-red-500"}`} />
                  <div>
                    <div className="font-medium text-foreground">{label}</div>
                    <div className={ok ? "text-green-500" : "text-red-400"}>{status}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Separator className="bg-border" />

        {/* Tabbed data tables */}
        <Tabs defaultValue="projects">
          <TabsList className="bg-muted/30 border border-border w-full sm:w-auto">
            <TabsTrigger value="projects" className="flex-1 sm:flex-none gap-1.5">
              <FolderKanban size={13} /> Projects
              {!projectsLoading && (
                <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0 h-4">
                  {projects?.length ?? 0}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="deployments" className="flex-1 sm:flex-none gap-1.5">
              <Rocket size={13} /> Deployments
              {!deploymentsLoading && (
                <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0 h-4">
                  {deployments?.length ?? 0}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Projects tab */}
          <TabsContent value="projects" className="mt-4">
            <Card className="bg-card border-border overflow-hidden">
              {projectsLoading ? (
                <div className="p-6 space-y-3">
                  {[1,2,3,4].map(i => <Skeleton key={i} className="h-10 rounded" />)}
                </div>
              ) : !projects?.length ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <FolderKanban size={32} className="text-muted-foreground opacity-40 mb-3" />
                  <p className="text-muted-foreground text-sm">No projects found.</p>
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
                        <TableHead className="hidden lg:table-cell">Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(projects ?? []).map((project) => (
                        <TableRow key={project.id} className="border-border">
                          <TableCell>
                            <div>
                              <Link href={`/projects/${project.id}`}>
                                <span className="font-medium hover:text-primary cursor-pointer transition-colors">
                                  {project.name}
                                </span>
                              </Link>
                              {project.description && (
                                <p className="text-xs text-muted-foreground truncate max-w-[180px]">
                                  {project.description}
                                </p>
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
                              {project.isPublic
                                ? <><Globe size={11} /> Public</>
                                : <><Lock size={11} /> Private</>}
                            </span>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <span className={`text-xs capitalize ${project.status === "active" ? "text-green-400" : "text-muted-foreground"}`}>
                              {project.status}
                            </span>
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
                </div>
              )}
            </Card>
          </TabsContent>

          {/* Deployments tab */}
          <TabsContent value="deployments" className="mt-4">
            <Card className="bg-card border-border overflow-hidden">
              {deploymentsLoading ? (
                <div className="p-6 space-y-3">
                  {[1,2,3].map(i => <Skeleton key={i} className="h-10 rounded" />)}
                </div>
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
                              <a
                                href={d.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline flex items-center gap-1 max-w-[200px] truncate"
                              >
                                {d.url.replace(/^https?:\/\//, "")} <ExternalLink size={10} />
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                            {d.region || "—"}
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
        </Tabs>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteName}</strong> and all its files.
              This action cannot be undone.
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
