import { Link } from "wouter";
import { Plus, LayoutDashboard, Rocket, Activity, Globe, FolderKanban, TerminalSquare, AlertCircle } from "lucide-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useGetProjectStats, useGetRecentProjects } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

function formatTimeAgo(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  
  if (diffInSeconds < 60) return "just now";
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 30) return `${diffInDays}d ago`;
  return date.toLocaleDateString();
}

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading, error: statsError } = useGetProjectStats();
  const { data: recentProjects, isLoading: projectsLoading } = useGetRecentProjects();

  return (
    <Layout>
      <div className="p-4 sm:p-8 max-w-6xl mx-auto w-full space-y-6 sm:space-y-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-1">Dashboard</h1>
            <p className="text-muted-foreground text-sm">Overview of your workspace.</p>
          </div>
          <Link href="/projects/new">
            <Button className="gap-2 font-medium shrink-0">
              <Plus size={16} /> <span className="hidden sm:inline">New Project</span><span className="sm:hidden">New</span>
            </Button>
          </Link>
        </div>

        {statsError ? (
          <div className="p-4 rounded-md bg-destructive/10 border border-destructive/20 text-destructive-foreground flex items-start gap-3">
            <AlertCircle size={20} className="text-destructive mt-0.5" />
            <div>
              <h3 className="font-semibold text-sm">Failed to load statistics</h3>
              <p className="text-sm opacity-90">Please ensure the API server is running.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Projects</CardTitle>
                <FolderKanban className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <div className="text-3xl font-bold">{stats?.totalProjects ?? 0}</div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Active Projects</CardTitle>
                <Activity className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <div className="text-3xl font-bold text-primary">{stats?.activeProjects ?? 0}</div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Deployments</CardTitle>
                <Rocket className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <div className="text-3xl font-bold">{stats?.totalDeployments ?? 0}</div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Live Sites</CardTitle>
                <Globe className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <div className="text-3xl font-bold text-green-500">{stats?.liveDeployments ?? 0}</div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight">Recent Projects</h2>
            <Link href="/projects" className="text-sm text-primary hover:underline font-medium">
              View all
            </Link>
          </div>

          {projectsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <Card key={i}>
                  <CardHeader className="pb-2">
                    <Skeleton className="h-5 w-3/4 mb-2" />
                    <Skeleton className="h-4 w-1/2" />
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-2 mt-4">
                      <Skeleton className="h-6 w-16" />
                      <Skeleton className="h-6 w-20" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : !recentProjects || recentProjects.length === 0 ? (
            <Card className="border-dashed bg-muted/30">
              <CardContent className="flex flex-col items-center justify-center p-12 text-center">
                <TerminalSquare className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
                <h3 className="text-lg font-bold mb-2">No projects found</h3>
                <p className="text-sm text-muted-foreground mb-6 max-w-md">
                  You haven't created any projects yet. Start a new project to launch your development environment.
                </p>
                <Link href="/projects/new">
                  <Button>Create Your First Project</Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {recentProjects.map(project => (
                <Link key={project.id} href={`/projects/${project.id}`}>
                  <Card className="group hover:border-primary/50 transition-colors cursor-pointer h-full flex flex-col hover-elevate">
                    <CardHeader className="pb-2 flex-none">
                      <div className="flex justify-between items-start mb-1">
                        <CardTitle className="text-base group-hover:text-primary transition-colors line-clamp-1">{project.name}</CardTitle>
                        {project.isPublic && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Public</Badge>}
                      </div>
                      <CardDescription className="line-clamp-2 text-xs">
                        {project.description || "No description provided"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="mt-auto pt-4 flex items-center justify-between text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="font-mono text-[10px] bg-secondary/50">
                          {project.language}
                        </Badge>
                        {project.status === 'active' && (
                          <span className="flex h-2 w-2 rounded-full bg-green-500"></span>
                        )}
                      </div>
                      <span>{formatTimeAgo(project.updatedAt)}</span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
