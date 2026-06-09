import { useState } from "react";
import { useParams } from "wouter";
import {
  ArrowLeft, Globe, Plus, Trash2, Edit2, ExternalLink,
  Check, X, Copy, MonitorPlay, Info, Wifi,
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

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  function doCopy() {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button onClick={doCopy} className="ml-1.5 text-muted-foreground hover:text-foreground transition-colors shrink-0">
      {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
    </button>
  );
}

export default function DeploymentDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const queryClient = useQueryClient();

  const { data: deployment, isLoading: deployLoading } = useGetDeployment(id);
  const { data: dnsRecords, isLoading: dnsLoading } = useListDnsRecords(id);
  const updateDeploy = useUpdateDeployment();
  const createDns   = useCreateDnsRecord();
  const updateDns   = useUpdateDnsRecord();
  const deleteDns   = useDeleteDnsRecord();

  const [customDomain, setCustomDomain] = useState("");
  const [domainSaved, setDomainSaved]   = useState(false);
  const [showDnsGuide, setShowDnsGuide] = useState(false);

  const [newRecord, setNewRecord]     = useState({ type: "A", name: "", value: "", ttl: 3600, priority: "" });
  const [showAddRecord, setShowAddRecord] = useState(false);
  const [editingRecord, setEditingRecord] = useState<number | null>(null);
  const [editRecord, setEditRecord]   = useState({ type: "A", name: "", value: "", ttl: 3600, priority: "" });

  // Derive the preview host from the deployment URL (e.g. "xxx.replit.dev")
  const previewHost = deployment?.url ? (() => {
    try { return new URL(deployment.url).hostname; } catch { return deployment.url; }
  })() : "";

  function handleSaveDomain() {
    const domain = customDomain.trim();
    if (!domain) return;
    updateDeploy.mutate({ id, data: { customDomain: domain } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDeploymentQueryKey(id) });
        setDomainSaved(true);
        setShowDnsGuide(true);
        setTimeout(() => setDomainSaved(false), 2000);
      },
    });
  }

  function handleAutoSetupDns() {
    if (!previewHost) return;
    const domain = (deployment?.customDomain ?? customDomain).trim();
    const records = [
      { type: "CNAME" as const, name: "@",   value: previewHost, ttl: 3600 },
      { type: "CNAME" as const, name: "www", value: previewHost, ttl: 3600 },
    ];
    records.forEach(r => {
      createDns.mutate({ id, data: r }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListDnsRecordsQueryKey(id) }),
      });
    });
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
      }
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
      }
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
              <Button className="gap-2 h-9">
                <MonitorPlay size={15} /> Open Live Preview
              </Button>
            </a>
          )}
        </div>

        {/* Live Preview embed (when live) */}
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
                <iframe
                  src={deployment.url}
                  className="w-full h-full border-0"
                  sandbox="allow-scripts allow-same-origin allow-forms"
                  title="Live Preview"
                />
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
                  <span className="font-mono text-sm text-green-400">{deployment.customDomain}</span>
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

        {/* Custom Domain */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Globe size={16} /> Custom Domain</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Connect your own domain to this deployment.</p>

            {deployment.customDomain && (
              <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/25 rounded-lg text-sm">
                <Check size={14} className="text-green-400 shrink-0" />
                <span className="text-green-300 font-mono">{deployment.customDomain}</span>
                <span className="text-muted-foreground ml-auto text-xs">connected</span>
              </div>
            )}

            <div className="flex gap-2">
              <Input
                placeholder={deployment.customDomain ?? "yourdomain.com"}
                value={customDomain}
                onChange={(e) => setCustomDomain(e.target.value)}
                className="font-mono bg-background"
              />
              <Button onClick={handleSaveDomain} disabled={updateDeploy.isPending || !customDomain.trim()}>
                {domainSaved ? <Check size={14} /> : "Save"}
              </Button>
            </div>

            {/* DNS setup guide — shows after saving or when domain already set */}
            {(showDnsGuide || deployment.customDomain) && previewHost && (
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b border-border">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <Info size={14} className="text-primary" /> DNS Setup Instructions
                  </span>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handleAutoSetupDns}>
                    <Plus size={11} /> Auto-Add Records
                  </Button>
                </div>
                <div className="p-4 space-y-3 text-sm text-muted-foreground">
                  <p>Add these DNS records at your domain registrar to point <strong className="text-foreground">{deployment.customDomain || customDomain}</strong> to this deployment:</p>
                  <div className="rounded-lg border border-border overflow-x-auto">
                    <table className="w-full text-xs min-w-[420px]">
                      <thead className="bg-muted/30">
                        <tr>
                          {["Type", "Name", "Value", "TTL"].map(h => (
                            <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {[
                          { type: "CNAME", name: "@",   value: previewHost, ttl: "3600" },
                          { type: "CNAME", name: "www", value: previewHost, ttl: "3600" },
                        ].map((r, i) => (
                          <tr key={i} className="hover:bg-muted/20">
                            <td className="px-3 py-2 font-mono font-semibold text-foreground">{r.type}</td>
                            <td className="px-3 py-2 font-mono">{r.name}</td>
                            <td className="px-3 py-2 font-mono">
                              <div className="flex items-center gap-1">
                                <span className="truncate max-w-[180px] text-primary">{r.value}</span>
                                <CopyButton value={r.value} />
                              </div>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{r.ttl}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground">DNS changes can take up to 48 hours to propagate. Click <strong>Auto-Add Records</strong> above to save these to your DNS Records list.</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* DNS Records */}
        <Card className="bg-card border-border">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">DNS Records</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setShowAddRecord(!showAddRecord)} className="gap-1.5 h-7 text-xs">
                <Plus size={12} /> Add Record
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
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
                    <Input className="h-8 text-xs font-mono" placeholder="@" value={newRecord.name} onChange={e => setNewRecord(r => ({ ...r, name: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">Value</Label>
                    <Input className="h-8 text-xs font-mono" placeholder="1.2.3.4" value={newRecord.value} onChange={e => setNewRecord(r => ({ ...r, value: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">TTL</Label>
                    <Input className="h-8 text-xs" type="number" value={newRecord.ttl} onChange={e => setNewRecord(r => ({ ...r, ttl: Number(e.target.value) }))} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleAddDns} disabled={createDns.isPending} className="h-7 text-xs">Add Record</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowAddRecord(false)} className="h-7 text-xs">Cancel</Button>
                </div>
              </div>
            )}

            {dnsLoading ? (
              <Skeleton className="h-24 rounded" />
            ) : !dnsRecords || dnsRecords.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <p className="text-sm text-muted-foreground">No DNS records yet.</p>
                {previewHost && deployment.customDomain && (
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handleAutoSetupDns}>
                    <Plus size={11} /> Auto-Setup CNAME for {deployment.customDomain}
                  </Button>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-border overflow-x-auto">
                <table className="w-full text-xs min-w-[500px]">
                  <thead className="bg-muted/30">
                    <tr>
                      {["Type", "Name", "Value", "TTL", ""].map(h => (
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
                            <td className="px-3 py-2">
                              <div className="flex gap-1">
                                <Button size="icon" className="h-6 w-6" onClick={() => handleUpdateDns(record.id)}><Check size={11} /></Button>
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingRecord(null)}><X size={11} /></Button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-2 font-mono font-medium">{record.type}</td>
                            <td className="px-3 py-2 font-mono text-muted-foreground">{record.name}</td>
                            <td className="px-3 py-2 font-mono text-muted-foreground max-w-xs">
                              <div className="flex items-center gap-1">
                                <span className="truncate">{record.value}</span>
                                <CopyButton value={record.value} />
                              </div>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{record.ttl}</td>
                            <td className="px-3 py-2">
                              <div className="flex gap-1 justify-end">
                                <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground" onClick={() => startEdit(record)}><Edit2 size={11} /></Button>
                                <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => handleDeleteDns(record.id)}><Trash2 size={11} /></Button>
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
