import { useState } from "react";
import { Link } from "wouter";
import { Plus, Search, FolderOpen, Trash2, Archive, Globe, Lock, Code2 } from "lucide-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useListProjects, useDeleteProject, getListProjectsQueryKey, getGetProjectStatsQueryKey, getGetRecentProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const LANGUAGE_COLORS: Record<string, string> = {
  javascript: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  typescript: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  python: "bg-green-500/20 text-green-400 border-green-500/30",
  rust: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  go: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  html: "bg-red-500/20 text-red-400 border-red-500/30",
};

function formatDate(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function Projects() {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const { data: projects, isLoading } = useListProjects();
  const deleteMutation = useDeleteProject();

  const filtered = (projects ?? []).filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.language.toLowerCase().includes(search.toLowerCase())
  );

  function handleDelete(id: number) {
    deleteMutation.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetProjectStatsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetRecentProjectsQueryKey() });
      },
    });
  }

  return (
    <Layout>
      <div className="p-4 sm:p-8 max-w-6xl mx-auto w-full space-y-5 sm:space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-1">Projects</h1>
            <p className="text-muted-foreground text-sm">All your projects in one place.</p>
          </div>
          <Link href="/projects/new">
            <Button className="gap-2">
              <Plus size={16} /> New Project
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
              <Card key={project.id} className="group bg-card border-border hover:border-primary/40 transition-all duration-200 hover:shadow-lg hover:shadow-primary/5">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base truncate">{project.name}</CardTitle>
                      {project.description && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">{project.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive">
                            <Trash2 size={13} />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Project</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete <strong>{project.name}</strong> and all its files. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => handleDelete(project.id)}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded border font-mono ${LANGUAGE_COLORS[project.language] ?? "bg-muted text-muted-foreground border-border"}`}>
                      {project.language}
                    </span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      {project.isPublic ? <Globe size={11} /> : <Lock size={11} />}
                      {project.isPublic ? "Public" : "Private"}
                    </span>
                    {project.status === "archived" && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Archive size={11} /> Archived
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Updated {formatDate(project.updatedAt)}</span>
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
    </Layout>
  );
}
