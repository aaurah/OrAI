import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Check } from "lucide-react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useListTemplates, useCreateProject, getListProjectsQueryKey, getGetProjectStatsQueryKey, getGetRecentProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";

const LANG_BADGE: Record<string, string> = {
  javascript: "bg-yellow-500/20 text-yellow-400",
  typescript: "bg-blue-500/20 text-blue-400",
  python: "bg-green-500/20 text-green-400",
  rust: "bg-orange-500/20 text-orange-400",
  go: "bg-cyan-500/20 text-cyan-400",
  html: "bg-red-500/20 text-red-400",
};

export default function NewProject() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { data: templates, isLoading: templatesLoading } = useListTemplates();
  const createMutation = useCreateProject();

  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState("");

  const chosen = templates?.find((t) => t.id === selectedTemplate);

  function handleCreate() {
    if (!name.trim()) { setError("Project name is required."); return; }
    if (!chosen) { setError("Please select a template."); return; }
    setError("");

    createMutation.mutate({
      data: {
        name: name.trim(),
        description: description.trim() || undefined,
        language: chosen.language,
        template: chosen.id,
        isPublic,
      },
    }, {
      onSuccess: (project) => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetProjectStatsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetRecentProjectsQueryKey() });
        navigate(`/projects/${project.id}`);
      },
      onError: () => setError("Failed to create project. Please try again."),
    });
  }

  return (
    <Layout>
      <div className="p-4 sm:p-8 max-w-4xl mx-auto w-full space-y-6 sm:space-y-8">
        <div className="flex items-center gap-3">
          <Link href="/projects">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft size={16} />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">New Project</h1>
            <p className="text-sm text-muted-foreground">Choose a template and configure your project.</p>
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Choose a Template</h2>
          {templatesLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {(templates ?? []).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTemplate(t.id)}
                  className={`relative text-left p-4 rounded-lg border transition-all duration-150 ${
                    selectedTemplate === t.id
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:border-primary/40 hover:bg-card/80"
                  }`}
                >
                  {selectedTemplate === t.id && (
                    <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                      <Check size={12} className="text-primary-foreground" />
                    </div>
                  )}
                  <div className={`text-xs px-1.5 py-0.5 rounded font-mono inline-block mb-2 ${LANG_BADGE[t.language] ?? "bg-muted text-muted-foreground"}`}>
                    {t.language}
                  </div>
                  <div className="font-medium text-sm text-foreground">{t.name}</div>
                  <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-5 bg-card border border-border rounded-lg p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Project Details</h2>
          <div className="space-y-2">
            <Label htmlFor="name">Project Name</Label>
            <Input
              id="name"
              placeholder="my-awesome-project"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(""); }}
              className="bg-background font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="desc">Description <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              id="desc"
              placeholder="A brief description of your project"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="bg-background"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="public" className="font-medium">Public Project</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Anyone can view this project</p>
            </div>
            <Switch id="public" checked={isPublic} onCheckedChange={setIsPublic} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3">
          <Link href="/projects">
            <Button variant="outline">Cancel</Button>
          </Link>
          <Button
            onClick={handleCreate}
            disabled={createMutation.isPending || !name.trim() || !selectedTemplate}
          >
            {createMutation.isPending ? "Creating..." : "Create Project"}
          </Button>
        </div>
      </div>
    </Layout>
  );
}
