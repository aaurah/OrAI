import { Layout } from "@/components/layout";

export default function Settings() {
  return (
    <Layout>
      <div className="p-4 sm:p-8 max-w-4xl mx-auto w-full space-y-6 sm:space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-1">Settings</h1>
          <p className="text-muted-foreground">Manage your account and workspace preferences.</p>
        </div>

        <div className="rounded-md border border-border bg-card p-12 text-center">
          <p className="text-muted-foreground">Settings are not implemented in this demo.</p>
        </div>
      </div>
    </Layout>
  );
}
