import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Sparkles, Bot } from "lucide-react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCreateProject, getListProjectsQueryKey, getGetProjectStatsQueryKey, getGetRecentProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const EXAMPLES = [
  "A weather app with 7-day forecast",
  "A todo list with drag-and-drop",
  "A portfolio website with dark mode",
  "A quiz app with score tracking",
  "A landing page for a SaaS product",
  "A login and signup form",
];

export default function NewProject() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const createMutation = useCreateProject();

  const [name, setName]           = useState("");
  const [description, setDescription] = useState("");
  const [buildPrompt, setBuildPrompt] = useState("");
  const [isPublic, setIsPublic]   = useState(false);
  const [error, setError]         = useState("");

  function handleCreate() {
    if (!name.trim()) { setError("Project name is required."); return; }
    setError("");

    createMutation.mutate({
      data: {
        name: name.trim(),
        description: description.trim() || undefined,
        language: "html",
        template: "blank",
        isPublic,
      },
    }, {
      onSuccess: (project) => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetProjectStatsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetRecentProjectsQueryKey() });

        // If user gave a build prompt, auto-queue it for the AI when IDE opens
        if (buildPrompt.trim()) {
          try {
            localStorage.setItem(`ide_autostart_${project.id}`, buildPrompt.trim());
          } catch {}
        }

        navigate(`/projects/${project.id}`);
      },
      onError: () => setError("Failed to create project. Please try again."),
    });
  }

  return (
    <Layout>
      <div className="p-4 sm:p-8 max-w-2xl mx-auto w-full space-y-6 sm:space-y-8">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/projects">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft size={16} />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">New Project</h1>
            <p className="text-sm text-muted-foreground">Name it, describe what to build — AI does the rest.</p>
          </div>
        </div>

        {/* AI prompt */}
        <div className="space-y-3 bg-primary/5 border border-primary/20 rounded-xl p-5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center">
              <Bot size={14} className="text-primary" />
            </div>
            <Label className="text-sm font-semibold">What would you like to build? <span className="text-muted-foreground font-normal">(optional)</span></Label>
          </div>
          <Textarea
            placeholder="e.g. A weather app with a 7-day forecast and dark mode"
            value={buildPrompt}
            onChange={(e) => setBuildPrompt(e.target.value)}
            className="bg-background resize-none min-h-[90px] text-sm"
          />
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => setBuildPrompt(ex)}
                className="text-xs px-2.5 py-1 rounded-full bg-muted hover:bg-primary/10 hover:text-primary border border-border hover:border-primary/30 text-muted-foreground transition-all"
              >
                {ex}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Sparkles size={11} className="text-primary" />
            The AI agent will automatically create all the files when you open the project.
          </p>
        </div>

        {/* Project details */}
        <div className="space-y-5 bg-card border border-border rounded-lg p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Project Details</h2>
          <div className="space-y-2">
            <Label htmlFor="name">Project Name <span className="text-destructive">*</span></Label>
            <Input
              id="name"
              placeholder="my-awesome-project"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(""); }}
              className="bg-background font-mono"
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              autoFocus
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
            disabled={createMutation.isPending || !name.trim()}
            className="gap-2"
          >
            {createMutation.isPending
              ? "Creating…"
              : buildPrompt.trim()
                ? <><Sparkles size={14} /> Create & Build</>
                : "Create Project"}
          </Button>
        </div>
      </div>
    </Layout>
  );
}
