import { useState, useEffect } from "react";
import { useParams } from "wouter";
import {
  ArrowLeft, Globe, Plus, Trash2, Edit2, ExternalLink,
  Check, X, Copy, MonitorPlay, Wifi, AlertTriangle,
  RefreshCw, ChevronRight, ShieldCheck, Clock, Info,
  Loader2, CheckCircle2, XCircle, ArrowRight,
} from "lucide-react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useGetDeployment,
  useUpdateDeployment,
  useListDnsRecords,
  useCreateDnsRecord,
  useUpdateDnsRecord,
  useDeleteDnsRecord,
  useVerifyDomain,
  getGetDeploymentQueryKey,
  getListDnsRecordsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const STATUS_STYLES: Record<string, string> = {
  live:     "bg-green-500/20 text-green-400 border-green-500/30",
  building: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  pending:  "bg-gray-500/20 text-gray-400 border-gray-500/30",
  failed:   "bg-red-500/20 text-red-400 border-red-500/30",
  stopped:  "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

const DNS_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV"] as const;

const REGISTRAR_TABS = ["Cloudflare", "Namecheap", "GoDaddy", "Route 53", "Other"] as const;
type RegistrarTab = typeof REGISTRAR_TABS[number];

function CopyButton({ value, className = "" }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  function doCopy() {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button onClick={doCopy} className={`ml-1.5 text-muted-foreground hover:text-foreground transition-colors shrink-0 ${className}`}>
      {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
    </button>
  );
}

function StepIndicator({ step, current }: { step: number; current: number }) {
  const done = current > step;
  const active = current === step;
  return (
    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border transition-all shrink-0
      ${done ? "bg-green-500/20 border-green-500/40 text-green-400" :
        active ? "bg-primary/20 border-primary/50 text-primary" :
        "bg-muted/30 border-border text-muted-foreground"}`}>
      {done ? <Check size={13} /> : step}
    </div>
  );
}

function PropagationBadge({ createdAt }: { createdAt: string }) {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const active = ageMs > 60_000;
  return active
    ? <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20"><CheckCircle2 size={9} /> Active</span>
    : <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"><Clock size={9} /> Propagating</span>;
}

function RegistrarGuide({ registrar, previewHost, domain }: { registrar: RegistrarTab; previewHost: string; domain: string }) {
  const guides: Record<RegistrarTab, { name: string; steps: string[] }> = {
    Cloudflare: {
      name: "Cloudflare",
      steps: [
        `Log in to dash.cloudflare.com and select your domain "${domain}"`,
        "Go to DNS → Records → Add record",
        `Set Type = CNAME, Name = @, Target = ${previewHost}, Proxy = DNS only (grey cloud)`,
        `Repeat for Name = www, Target = ${previewHost}`,
        "Save and click Verify Domain below",
      ],
    },
    Namecheap: {
      name: "Namecheap",
      steps: [
        `Log in to namecheap.com → Domain List → Manage for "${domain}"`,
        "Click Advanced DNS tab",
        `Add CNAME Record: Host = @, Value = ${previewHost}, TTL = Automatic`,
        `Add CNAME Record: Host = www, Value = ${previewHost}, TTL = Automatic`,
        "Save all changes and click Verify Domain below",
      ],
    },
    GoDaddy: {
      name: "GoDaddy",
      steps: [
        `Log in to godaddy.com → My Products → DNS for "${domain}"`,
        "Click Add under DNS Records",
        `Type = CNAME, Name = @, Value = ${previewHost}`,
        `Repeat: Type = CNAME, Name = www, Value = ${previewHost}`,
        "Save and click Verify Domain below",
      ],
    },
    "Route 53": {
      name: "AWS Route 53",
      steps: [
        `Open Route 53 → Hosted Zones → select "${domain}"`,
        "Create Record → Simple routing",
        `Record name = blank (apex), Type = CNAME, Value = ${previewHost}`,
        `Record name = www, Type = CNAME, Value = ${previewHost}`,
        "Create records and click Verify Domain below",
      ],
    },
    Other: {
      name: "Other registrar",
      steps: [
        `Log in to your domain registrar's DNS management panel`,
        "Find DNS Records / Zone Editor / Name Servers section",
        `Add CNAME: Name = @ (or blank), Points to = ${previewHost}`,
        `Add CNAME: Name = www, Points to = ${previewHost}`,
        "Save changes. DNS can take up to 48h to propagate. Click Verify Domain when ready.",
      ],
    },
  };
  const guide = guides[registrar];
  return (
    <ol className="space-y-2 mt-3">
      {guide.steps.map((step, i) => (
        <li key={i} className="flex gap-3 text-sm text-muted-foreground">
          <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-medium mt-0.5">{i + 1}</span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

function validateDomain(domain: string) {
  const trimmed = domain.trim().toLowerCase().replace(/^https?:\/\//, "");
  const re = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
  return re.test(trimmed) ? trimmed : null;
}

export default function DeploymentDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const queryClient = useQueryClient();

  const { data: deployment, isLoading: deployLoading } = useGetDeployment(id);
  const { data: dnsRecords, isLoading: dnsLoading } = useListDnsRecords(id);
  const updateDeploy = useUpdateDeployment();
  const createDns    = useCreateDnsRecord();
  const updateDns    = useUpdateDnsRecord();
  const deleteDns    = useDeleteDnsRecord();
  const verifyDomain = useVerifyDomain();

  // Domain wizard state
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [domainInput, setDomainInput] = useState("");
  const [domainError, setDomainError] = useState("");
  const [activeRegistrar, setActiveRegistrar] = useState<RegistrarTab>("Cloudflare");
  const [verifyResult, setVerifyResult] = useState<{ verified: boolean; message: string } | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [savingDomain, setSavingDomain] = useState(false);

  // DNS record state
  const [newRecord, setNewRecord]         = useState({ type: "A", name: "", value: "", ttl: 3600, priority: "" });
  const [showAddRecord, setShowAddRecord] = useState(false);
  const [editingRecord, setEditingRecord] = useState<number | null>(null);
  const [editRecord, setEditRecord]       = useState({ type: "A", name: "", value: "", ttl: 3600, priority: "" });

  const previewHost = deployment?.url ? (() => {
    try { return new URL(deployment.url).hostname; } catch { return deployment.url; }
  })() : "";

  // Initialize wizard step based on existing state
  useEffect(() => {
    if (!deployment) return;
    if (deployment.domainVerified) { setWizardStep(3); return; }
    if (deployment.customDomain) { setWizardStep(2); setDomainInput(deployment.customDomain); return; }
    setWizardStep(1);
  }, [deployment?.id, deployment?.customDomain, deployment?.domainVerified]);

  function handleSaveDomain() {
    const valid = validateDomain(domainInput);
    if (!valid) { setDomainError("Enter a valid domain like yourdomain.com"); return; }
    setDomainError("");
    setSavingDomain(true);
    updateDeploy.mutate({ id, data: { customDomain: valid } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDeploymentQueryKey(id) });
        setSavingDomain(false);
        setWizardStep(2);
      },
      onError: () => setSavingDomain(false),
    });
  }

  function handleAutoSetupDns() {
    if (!previewHost) return;
    const domain = deployment?.customDomain ?? domainInput;
    [{ type: "CNAME" as const, name: "@", value: previewHost, ttl: 3600 },
     { type: "CNAME" as const, name: "www", value: previewHost, ttl: 3600 }].forEach(r => {
      createDns.mutate({ id, data: r }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListDnsRecordsQueryKey(id) }),
      });
    });
  }

  function handleVerify() {
    setIsVerifying(true);
    setVerifyResult(null);
    verifyDomain.mutate({ id }, {
      onSuccess: (result) => {
        setVerifyResult({ verified: result.verified, message: result.message });
        setIsVerifying(false);
        if (result.verified) {
          queryClient.invalidateQueries({ queryKey: getGetDeploymentQueryKey(id) });
          setWizardStep(3);
        }
      },
      onError: () => {
        setVerifyResult({ verified: false, message: "Verification request failed. Please try again." });
        setIsVerifying(false);
      },
    });
  }

  function handleChangeDomain() {
    setWizardStep(1);
    setVerifyResult(null);
    setDomainInput(deployment?.customDomain ?? "");
  }

  function handleAddDns() {
    if (!newRecord.name || !newRecord.value) return;
    createDns.mutate({
      id,
      data: {
        type: newRecord.type as typeof DNS_TYPES[number],
        name: newRecord.name, value: newRecord.value,
        ttl: newRecord.ttl,
        priority: newRecord.priority ? Number(newRecord.priority) : undefined,
      },
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDnsRecordsQueryKey(id) });
        setNewRecord({ type: "A", name: "", value: "", ttl: 3600, priority: "" });
        setShowAddRecord(false);
      },
    });
  }

  function startEdit(r: { id: number; type: string; name: string; value: string; ttl: number; priority?: number | null }) {
    setEditingRecord(r.id);
    setEditRecord({ type: r.type, name: r.name, value: r.value, ttl: r.ttl, priority: r.priority ? String(r.priority) : "" });
  }

  function handleUpdateDns(recordId: number) {
    updateDns.mutate({
      id, recordId,
      data: {
        type: editRecord.type as typeof DNS_TYPES[number],
        name: editRecord.name, value: editRecord.value,
        ttl: editRecord.ttl,
        priority: editRecord.priority ? Number(editRecord.priority) : undefined,
      },
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDnsRecordsQueryKey(id) });
        setEditingRecord(null);
      },
    });
  }

  function handleDeleteDns(recordId: number) {
    deleteDns.mutate({ id, recordId }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListDnsRecordsQueryKey(id) }),
    });
  }

  if (deployLoading) {
    return (
      <Layout>
        <div className="p-4 sm:p-8 space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-60 rounded-lg" />
        </div>
      </Layout>
    );
  }

  if (!deployment) {
    return (
      <Layout>
        <div className="p-4 sm:p-8 text-center">
          <p className="text-muted-foreground">Deployment not found.</p>
          <Link href="/deployments"><Button variant="outline" className="mt-4">Back to Deployments</Button></Link>
        </div>
      </Layout>
    );
  }

  const isLive = deployment.status === "live";
  const activeDomain = deployment.customDomain || deployment.url;

  return (
    <Layout>
      <div className="p-4 sm:p-8 max-w-4xl mx-auto w-full space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link href="/deployments">
              <Button variant="ghost" size="icon" className="h-8 w-8"><ArrowLeft size={16} /></Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Deployment #{deployment.id}</h1>
              <p className="text-sm text-muted-foreground">{deployment.projectName ?? `Project ${deployment.projectId}`}</p>
            </div>
          </div>
          {isLive && deployment.url && (
            <a href={deployment.url} target="_blank" rel="noopener noreferrer">
              <Button className="gap-2 h-9"><MonitorPlay size={15} /> Open Live Preview</Button>
            </a>
          )}
        </div>

        {/* Live Preview embed */}
        {isLive && deployment.url && (
          <Card className="bg-card border-border overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Wifi size={15} className="text-green-400" /> Live Preview
                </CardTitle>
                <a href={deployment.url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                  {deployment.url} <ExternalLink size={11} />
                </a>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="bg-white" style={{ height: 320 }}>
                <iframe src={deployment.url} className="w-full h-full border-0"
                  sandbox="allow-scripts allow-same-origin allow-forms" title="Live Preview" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Deployment Info */}
        <Card className="bg-card border-border">
          <CardHeader><CardTitle className="text-base">Deployment Info</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
              <div>
                <span className="text-muted-foreground block text-xs mb-1">Status</span>
                <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_STYLES[deployment.status] ?? ""}`}>
                  {deployment.status}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs mb-1">Region</span>
                <span className="font-mono text-sm">{deployment.region ?? "us-east-1"}</span>
              </div>
              {deployment.url && (
                <div className="min-w-0">
                  <span className="text-muted-foreground block text-xs mb-1">Preview URL</span>
                  <div className="flex items-center gap-1 min-w-0">
                    <a href={deployment.url} target="_blank" rel="noopener noreferrer"
                      className="text-primary hover:underline text-sm font-mono truncate max-w-[260px]">
                      {deployment.url}
                    </a>
                    <ExternalLink size={12} className="text-primary shrink-0" />
                    <CopyButton value={deployment.url} />
                  </div>
                </div>
              )}
              {deployment.customDomain && (
                <div>
                  <span className="text-muted-foreground block text-xs mb-1">Custom Domain</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-green-400">{deployment.customDomain}</span>
                    {deployment.domainVerified
                      ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 flex items-center gap-1"><ShieldCheck size={9} /> Verified</span>
                      : <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 flex items-center gap-1"><Clock size={9} /> Pending</span>
                    }
                  </div>
                </div>
              )}
            </div>
            {deployment.buildLog && (
              <div>
                <span className="text-muted-foreground text-xs block mb-1">Build Log</span>
                <pre className="bg-background rounded p-3 text-xs font-mono text-muted-foreground overflow-auto max-h-32 ide-scroll">
                  {deployment.buildLog}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Domain Import Wizard ──────────────────────────────────────────── */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe size={16} /> Domain Import
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Step progress bar */}
            <div className="flex items-center gap-0">
              {([
                { n: 1, label: "Enter Domain" },
                { n: 2, label: "Configure DNS" },
                { n: 3, label: "Verify" },
              ] as const).map(({ n, label }, i) => (
                <div key={n} className="flex items-center gap-0 flex-1 min-w-0">
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <StepIndicator step={n} current={wizardStep} />
                    <span className={`text-[10px] whitespace-nowrap font-medium ${wizardStep === n ? "text-primary" : wizardStep > n ? "text-green-400" : "text-muted-foreground"}`}>
                      {label}
                    </span>
                  </div>
                  {i < 2 && (
                    <div className={`flex-1 h-px mx-2 mb-4 ${wizardStep > n ? "bg-green-500/40" : "bg-border"}`} />
                  )}
                </div>
              ))}
            </div>

            {/* Step 1: Enter Domain */}
            {wizardStep === 1 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Enter the domain you want to connect to this deployment. You must own this domain.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="domain-input" className="text-xs">Domain name</Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="domain-input"
                        placeholder="yourdomain.com"
                        value={domainInput}
                        onChange={(e) => { setDomainInput(e.target.value); setDomainError(""); }}
                        onKeyDown={(e) => e.key === "Enter" && handleSaveDomain()}
                        className="pl-8 font-mono bg-background"
                      />
                    </div>
                    <Button onClick={handleSaveDomain} disabled={savingDomain || !domainInput.trim()} className="gap-1.5">
                      {savingDomain ? <Loader2 size={14} className="animate-spin" /> : <>Continue <ArrowRight size={14} /></>}
                    </Button>
                  </div>
                  {domainError && (
                    <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle size={11} /> {domainError}</p>
                  )}
                </div>
                <div className="rounded-lg bg-muted/30 border border-border p-3 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground text-xs">What happens next?</p>
                  <p>We'll walk you through adding DNS records at your registrar to point this domain at your deployment. No transferring required — your domain stays at its current registrar.</p>
                </div>
              </div>
            )}

            {/* Step 2: Configure DNS */}
            {wizardStep === 2 && (
              <div className="space-y-5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-sm font-medium">Configure DNS for <span className="font-mono text-primary">{deployment?.customDomain ?? domainInput}</span></p>
                    <p className="text-xs text-muted-foreground mt-0.5">Add these records at your domain registrar, then verify below.</p>
                  </div>
                  <Button variant="ghost" size="sm" className="text-xs h-7 gap-1" onClick={handleChangeDomain}>
                    <Edit2 size={11} /> Change domain
                  </Button>
                </div>

                {/* Required DNS Records table */}
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b border-border">
                    <span className="text-xs font-medium text-foreground">Required DNS Records</span>
                    <Button size="sm" variant="outline" className="h-6 text-xs gap-1" onClick={handleAutoSetupDns} disabled={createDns.isPending}>
                      {createDns.isPending ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
                      Auto-Add to Records
                    </Button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[420px]">
                      <thead className="bg-muted/10">
                        <tr>
                          {["Type", "Name", "Value", "TTL"].map(h => (
                            <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {[
                          { type: "CNAME", name: "@",   value: previewHost || "your-preview-host.replit.dev", ttl: "3600" },
                          { type: "CNAME", name: "www", value: previewHost || "your-preview-host.replit.dev", ttl: "3600" },
                        ].map((r, i) => (
                          <tr key={i} className="hover:bg-muted/20">
                            <td className="px-3 py-2.5 font-mono font-semibold text-blue-400">{r.type}</td>
                            <td className="px-3 py-2.5 font-mono text-foreground">{r.name}</td>
                            <td className="px-3 py-2.5 font-mono">
                              <div className="flex items-center gap-1">
                                <span className="text-primary truncate max-w-[200px]">{r.value}</span>
                                <CopyButton value={r.value} />
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-muted-foreground">{r.ttl}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Registrar-specific guide */}
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="px-4 py-2.5 bg-muted/30 border-b border-border">
                    <span className="text-xs font-medium">Step-by-step guide for your registrar</span>
                  </div>
                  <div className="flex border-b border-border overflow-x-auto">
                    {REGISTRAR_TABS.map(tab => (
                      <button
                        key={tab}
                        onClick={() => setActiveRegistrar(tab)}
                        className={`px-4 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors
                          ${activeRegistrar === tab
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"}`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                  <div className="p-4">
                    <RegistrarGuide
                      registrar={activeRegistrar}
                      previewHost={previewHost || "your-preview-host.replit.dev"}
                      domain={deployment?.customDomain ?? domainInput}
                    />
                  </div>
                </div>

                {/* Verify button */}
                <div className="flex items-center gap-3 flex-wrap">
                  <Button onClick={handleVerify} disabled={isVerifying} className="gap-2">
                    {isVerifying
                      ? <><Loader2 size={14} className="animate-spin" /> Checking DNS…</>
                      : <><RefreshCw size={14} /> Verify Domain</>}
                  </Button>
                  <p className="text-xs text-muted-foreground">DNS changes can take up to 48 hours to propagate.</p>
                </div>

                {verifyResult && (
                  <div className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${
                    verifyResult.verified
                      ? "bg-green-500/10 border-green-500/25 text-green-300"
                      : "bg-yellow-500/10 border-yellow-500/25 text-yellow-300"}`}>
                    {verifyResult.verified
                      ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                      : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
                    <div>
                      <p className="font-medium">{verifyResult.verified ? "Domain verified!" : "Not verified yet"}</p>
                      <p className="text-xs mt-0.5 opacity-80">{verifyResult.message}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Verified */}
            {wizardStep === 3 && (
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 bg-green-500/10 border border-green-500/25 rounded-lg">
                  <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                    <ShieldCheck size={20} className="text-green-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-green-300">Domain verified</p>
                    <p className="text-sm text-green-400/80 font-mono mt-0.5">{deployment.customDomain}</p>
                  </div>
                  <div className="ml-auto flex gap-2">
                    <a href={`https://${deployment.customDomain}`} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10">
                        <ExternalLink size={12} /> Visit
                      </Button>
                    </a>
                    <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={handleChangeDomain}>
                      <Edit2 size={12} /> Change
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border border-border p-3 space-y-1">
                    <p className="text-xs text-muted-foreground">Primary domain</p>
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-primary">{deployment.customDomain}</span>
                      <CopyButton value={deployment.customDomain!} />
                    </div>
                  </div>
                  <div className="rounded-lg border border-border p-3 space-y-1">
                    <p className="text-xs text-muted-foreground">Pointing to</p>
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-sm truncate">{previewHost}</span>
                      <CopyButton value={previewHost} />
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Info size={11} /> Manage the underlying DNS records in the section below.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── DNS Records ───────────────────────────────────────────────────── */}
        <Card className="bg-card border-border">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">DNS Records</CardTitle>
                {deployment.customDomain && (
                  <p className="text-xs text-muted-foreground mt-0.5">for <span className="font-mono">{deployment.customDomain}</span></p>
                )}
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowAddRecord(!showAddRecord)} className="gap-1.5 h-7 text-xs">
                <Plus size={12} /> Add Record
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">

            {/* Add record form */}
            {showAddRecord && (
              <div className="bg-background border border-border rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-medium">New DNS Record</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div>
                    <Label className="text-xs">Type</Label>
                    <Select value={newRecord.type} onValueChange={(v) => setNewRecord(r => ({ ...r, type: v }))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{DNS_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Name</Label>
                    <Input className="h-8 text-xs font-mono" placeholder="@" value={newRecord.name}
                      onChange={e => setNewRecord(r => ({ ...r, name: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">Value</Label>
                    <Input className="h-8 text-xs font-mono" placeholder="1.2.3.4" value={newRecord.value}
                      onChange={e => setNewRecord(r => ({ ...r, value: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">TTL (s)</Label>
                    <Input className="h-8 text-xs" type="number" value={newRecord.ttl}
                      onChange={e => setNewRecord(r => ({ ...r, ttl: Number(e.target.value) }))} />
                  </div>
                </div>
                {(newRecord.type === "MX" || newRecord.type === "SRV") && (
                  <div className="max-w-[120px]">
                    <Label className="text-xs">Priority</Label>
                    <Input className="h-8 text-xs" type="number" placeholder="10" value={newRecord.priority}
                      onChange={e => setNewRecord(r => ({ ...r, priority: e.target.value }))} />
                  </div>
                )}
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleAddDns} disabled={createDns.isPending || !newRecord.name || !newRecord.value} className="h-7 text-xs gap-1">
                    {createDns.isPending ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                    Add Record
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowAddRecord(false)} className="h-7 text-xs">Cancel</Button>
                </div>
              </div>
            )}

            {dnsLoading ? (
              <Skeleton className="h-24 rounded" />
            ) : !dnsRecords || dnsRecords.length === 0 ? (
              <div className="text-center py-10 space-y-3">
                <div className="w-10 h-10 rounded-full bg-muted/30 flex items-center justify-center mx-auto">
                  <Globe size={18} className="text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">No DNS records yet.</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Add individual records above or use Auto-Add in the Domain Import wizard.</p>
                </div>
                {previewHost && deployment.customDomain && (
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs mx-auto" onClick={handleAutoSetupDns}>
                    <Plus size={11} /> Auto-Setup CNAME for {deployment.customDomain}
                  </Button>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-xs min-w-[520px] overflow-x-auto">
                  <thead className="bg-muted/30">
                    <tr>
                      {["Type", "Name", "Value", "TTL", "Status", ""].map(h => (
                        <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dnsRecords.map(record => (
                      <tr key={record.id} className="hover:bg-muted/20 transition-colors">
                        {editingRecord === record.id ? (
                          <>
                            <td className="px-3 py-2">
                              <Select value={editRecord.type} onValueChange={v => setEditRecord(r => ({ ...r, type: v }))}>
                                <SelectTrigger className="h-6 text-xs w-20"><SelectValue /></SelectTrigger>
                                <SelectContent>{DNS_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                              </Select>
                            </td>
                            <td className="px-3 py-2"><Input className="h-6 text-xs font-mono" value={editRecord.name} onChange={e => setEditRecord(r => ({ ...r, name: e.target.value }))} /></td>
                            <td className="px-3 py-2"><Input className="h-6 text-xs font-mono" value={editRecord.value} onChange={e => setEditRecord(r => ({ ...r, value: e.target.value }))} /></td>
                            <td className="px-3 py-2"><Input className="h-6 text-xs w-16" type="number" value={editRecord.ttl} onChange={e => setEditRecord(r => ({ ...r, ttl: Number(e.target.value) }))} /></td>
                            <td className="px-3 py-2"></td>
                            <td className="px-3 py-2">
                              <div className="flex gap-1">
                                <Button size="icon" className="h-6 w-6" onClick={() => handleUpdateDns(record.id)}
                                  disabled={updateDns.isPending}><Check size={11} /></Button>
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingRecord(null)}><X size={11} /></Button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-2">
                              <span className="font-mono font-semibold text-blue-400">{record.type}</span>
                            </td>
                            <td className="px-3 py-2 font-mono text-muted-foreground">{record.name}</td>
                            <td className="px-3 py-2 font-mono text-muted-foreground max-w-[180px]">
                              <div className="flex items-center gap-1">
                                <span className="truncate">{record.value}</span>
                                <CopyButton value={record.value} />
                              </div>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{record.ttl}</td>
                            <td className="px-3 py-2">
                              <PropagationBadge createdAt={record.createdAt} />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex gap-1 justify-end">
                                <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                  onClick={() => startEdit(record)}><Edit2 size={11} /></Button>
                                <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                  onClick={() => handleDeleteDns(record.id)}
                                  disabled={deleteDns.isPending}><Trash2 size={11} /></Button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </Layout>
  );
}
