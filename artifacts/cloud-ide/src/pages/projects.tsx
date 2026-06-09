import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Plus, Search, FolderOpen, Trash2, Globe, Lock, Code2, MoreVertical, Eye, EyeOff } from "lucide-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useListProjects,
  useDeleteProject,
  useUpdateProject,
  getListProjectsQueryKey,
  getGetProjectStatsQueryKey,
  getGetRecentProjectsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const LANGUAGE_COLORS: Record<string, string> = {
  javascript: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  typescript: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  python:     "bg-green-500/20 text-green-400 border-green-500/30",
  rust:       "bg-orange-500/20 text-orange-400 border-orange-500/30",
  go:         "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  html:       "bg-red-500/20 text-red-400 border-red-500/30",
};

function formatDate(dateString: string) {
  const date = new Date(dateString);
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60)    return "just now";
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function Projects() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState("");
  const queryClient = useQueryClient();

  const { data: projects, isLoading } = useListProjects();
  const deleteMutation  = useDeleteProject();
  const updateMutation  = useUpdateProject();

  const filtered = (projects ?? []).filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.language.toLowerCase().includes(search.toLowerCase())
  );

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetProjectStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetRecentProjectsQueryKey() });
  }

  function toggleVisibility(id: number, currentlyPublic: boolean) {
    updateMutation.mutate(
      { id, data: { isPublic: !currentlyPublic } },
      {
        onSuccess: () => {
          invalidateAll();
          toast({
            title: currentlyPublic ? "Project set to Private" : "Project set to Public",
            description: currentlyPublic
              ? "Only you can see this project."
              : "Anyone with the link can view this project.",
          });
        },
        onError: () => toast({ title: "Update failed", variant: "destructive" }),
      }
    );
  }

  function requestDelete(id: number, name: string) {
    setConfirmDeleteId(id);
    setConfirmDeleteName(name);
  }

  function confirmDelete() {
    if (!confirmDeleteId) return;
    deleteMutation.mutate(
      { id: confirmDeleteId },
      {
        onSuccess: () => {
          invalidateAll();
          toast({ title: "Project deleted" });
        },
        onError: () => toast({ title: "Delete failed", variant: "destructive" }),
      }
    );
    setConfirmDeleteId(null);
  }

  return (
    <Layout>
      <div className="p-4 sm:p-8 max-w-6xl mx-auto w-full space-y-5 sm:space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-1">Projects</h1>
            <p className="text-muted-foreground text-sm">All your projects in one place.</p>
          </div>
          <Link href="/projects/new">
            <Button className="gap-2 shrink-0">
              <Plus size={16} />
              <span className="hidden sm:inline">New Project</span>
              <span className="sm:hidden">New</span>
            </Button>
          </Link>
        </div>

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9 bg-card border-border"
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center mb-4">
              <Code2 size={28} className="text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-lg mb-1">
              {search ? "No projects match your search" : "No projects yet"}
            </h3>
            <p className="text-muted-foreground text-sm mb-6">
              {search ? "Try a different search term." : "Create your first project to get started."}
            </p>
            {!search && (
              <Link href="/projects/new">
                <Button><Plus size={16} className="mr-2" /> Create Project</Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((project) => (
              <Card
                key={project.id}
                className="bg-card border-border hover:border-primary/40 transition-all duration-200 hover:shadow-lg hover:shadow-primary/5"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base truncate">{project.name}</CardTitle>
                      {project.description && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                          {project.description}
                        </p>
                      )}
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          <MoreVertical size={15} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={() => navigate(`/projects/${project.id}`)}>
                          <FolderOpen size={14} className="mr-2" /> Open
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => toggleVisibility(project.id, project.isPublic)}
                          disabled={updateMutation.isPending}
                        >
                          {project.isPublic
                            ? <><EyeOff size={14} className="mr-2" /> Make Private</>
                            : <><Eye size={14} className="mr-2" /> Make Public</>}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive focus:bg-destructive/10"
                          onClick={() => requestDelete(project.id, project.name)}
                        >
                          <Trash2 size={14} className="mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>

                <CardContent className="pt-0 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-xs px-2 py-0.5 rounded border font-mono ${
                        LANGUAGE_COLORS[project.language] ?? "bg-muted text-muted-foreground border-border"
                      }`}
                    >
                      {project.language}
                    </span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      {project.isPublic
                        ? <><Globe size={11} /> Public</>
                        : <><Lock size={11} /> Private</>}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Updated {formatDate(project.updatedAt)}
                    </span>
                    <Link href={`/projects/${project.id}`}>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5">
                        <FolderOpen size={12} /> Open
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <AlertDialog
        open={!!confirmDeleteId}
        onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{confirmDeleteName}</strong> and all its
              files. This action cannot be undone.
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
