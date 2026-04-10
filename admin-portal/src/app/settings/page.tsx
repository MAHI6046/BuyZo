export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Settings</h1>
        <p className="mt-1 text-foreground/50">
          Portal configuration and environment checks.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-white p-6">
        <h2 className="text-lg font-semibold text-foreground">Status</h2>
        <p className="mt-2 text-sm text-foreground/70">
          This page is live. You can now open <span className="font-mono">/settings</span> without
          404.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-white p-6">
        <h2 className="text-lg font-semibold text-foreground">Next</h2>
        <p className="mt-2 text-sm text-foreground/70">
          We can add admin-managed settings here (feature flags, thresholds, support contacts,
          etc.) backed by API endpoints.
        </p>
      </div>
    </div>
  );
}
