import { Layout } from "@/components/layout";
import { useListAllDeployments, useDeleteDeployment, getListAllDeploymentsQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExternalLink, Rocket, AlertCircle, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";

function DeploymentStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'live':
      return <Badge className="bg-green-500/15 text-green-500 hover:bg-green-500/25 border-green-500/20">Live</Badge>;
    case 'building':
      return <Badge className="bg-amber-500/15 text-amber-500 hover:bg-amber-500/25 border-amber-500/20">Building</Badge>;
    case 'failed':
      return <Badge className="bg-red-500/15 text-red-500 hover:bg-red-500/25 border-red-500/20">Failed</Badge>;
    case 'stopped':
      return <Badge variant="secondary" className="text-muted-foreground">Stopped</Badge>;
    default:
      return <Badge variant="outline" className="text-muted-foreground">Pending</Badge>;
  }
}

export default function Deployments() {
  const { data: deployments, isLoading, error } = useListAllDeployments();
  const deleteDeployment = useDeleteDeployment();
  const queryClient = useQueryClient();

  function handleDelete(id: number) {
    deleteDeployment.mutate({ id }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAllDeploymentsQueryKey() }),
    });
  }

  return (
    <Layout>
      <div className="p-4 sm:p-8 max-w-6xl mx-auto w-full space-y-6 sm:space-y-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-1">Deployments</h1>
          <p className="text-muted-foreground text-sm">Manage your deployed applications and custom domains.</p>
        </div>

        {error ? (
          <div className="p-4 rounded-md bg-destructive/10 border border-destructive/20 text-destructive-foreground flex items-start gap-3">
            <AlertCircle size={20} className="text-destructive mt-0.5" />
            <div>
              <h3 className="font-semibold text-sm">Failed to load deployments</h3>
              <p className="text-sm opacity-90">Please ensure the API server is running.</p>
            </div>
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-6 space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-4">
                      <Skeleton className="h-10 w-full" />
                    </div>
                  ))}
                </div>
              ) : !deployments || deployments.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-center">
                  <Rocket className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
                  <h3 className="text-lg font-bold mb-2">No deployments yet</h3>
                  <p className="text-sm text-muted-foreground mb-6 max-w-md">
                    You haven't deployed any projects. Open a project in the IDE and click "Deploy" to publish it.
                  </p>
                  <Link href="/projects">
                    <Button variant="outline">Browse Projects</Button>
                  </Link>
                </div>
              ) : (
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Project</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>URL / Domain</TableHead>
                      <TableHead>Region</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deployments.map((deployment) => (
                      <TableRow key={deployment.id}>
                        <TableCell className="font-medium">
                          <Link href={`/projects/${deployment.projectId}`} className="hover:text-primary hover:underline">
                            {deployment.projectName || `Project #${deployment.projectId}`}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <DeploymentStatusBadge status={deployment.status} />
                        </TableCell>
                        <TableCell>
                          {deployment.customDomain ? (
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{deployment.customDomain}</span>
                              <Badge variant="outline" className="text-[10px] px-1 py-0">Custom</Badge>
                            </div>
                          ) : deployment.url ? (
                            <a href={deployment.url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1">
                              {deployment.url.replace(/^https?:\/\//, '')} <ExternalLink size={12} />
                            </a>
                          ) : (
                            <span className="text-sm text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {deployment.region || 'auto'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Link href={`/deployments/${deployment.id}`}>
                              <Button variant="secondary" size="sm">Manage</Button>
                            </Link>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                  disabled={deleteDeployment.isPending}
                                >
                                  <Trash2 size={14} />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete deployment?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will permanently remove deployment #{deployment.id}
                                    {deployment.projectName ? ` for "${deployment.projectName}"` : ""}.
                                    This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={() => handleDelete(deployment.id)}
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
