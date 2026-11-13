import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useMe } from "@/lib/auth";
import type { MutasiStatus } from "@/lib/types";

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-col gap-4 animate-rise md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl" data-testid="page-title">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export const STATUS_META: Record<MutasiStatus, { label: string; cls: string }> = {
  belum: { label: "Belum cek", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  ok: { label: "Sudah OK", cls: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300" },
  perlu: { label: "Perlu cek", cls: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300" },
};

export function StatusPill({ status, testId }: { status: MutasiStatus; testId?: string }) {
  const m = STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", m.cls)} data-testid={testId}>
      {m.label}
    </span>
  );
}

export function Stat({ label, value, hint, accent, testId }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean; testId?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-md md:p-5",
        accent && "border-amber-500/40 shadow-[0_8px_30px_-12px_rgba(217,119,6,0.35)]",
      )}
      data-testid={testId}
    >
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="num mt-2 text-xl font-medium md:text-2xl">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-muted", className)}>
      <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-600 transition-[width] duration-500" style={{ width: `${v}%` }} />
    </div>
  );
}

export function EmptyState({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="rounded-xl border border-dashed bg-card/50 px-6 py-10 text-center text-sm text-muted-foreground" data-testid={testId}>
      {children}
    </div>
  );
}

/** Route guard: sends users to their first permitted module if they lack this one. */
export function RequireModule({ module, children }: { module: string; children: ReactNode }) {
  const me = useMe();
  if (!me.data) return null;
  if (!me.data.modules.includes(module)) {
    const first = me.data.modules[0];
    const map: Record<string, string> = { dashboard: "/", mutasi: "/mutasi", donatur: "/donatur", program: "/program", cicilan: "/cicilan", bukti: "/bukti", voucher: "/voucher", pengguna: "/pengguna", audit: "/audit", pengaturan: "/pengaturan", laporan: "/laporan" };
    const to = first ? map[first] : "/login";
    return to === "/" && module === "dashboard" ? <Navigate to="/cicilan" replace /> : <Navigate to={to} replace />;
  }
  return <>{children}</>;
}
