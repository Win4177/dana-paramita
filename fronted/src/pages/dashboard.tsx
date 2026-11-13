import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CircleCheck, Info } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, PageHeader, Progress, Stat } from "@/components/common";
import { apiGet } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { bulan, rupiah, tanggal } from "@/lib/format";
import type { Dashboard as DashboardData } from "@/lib/types";
import { cn } from "@/lib/utils";

const SEV = { danger: "text-red-600 dark:text-red-400", warning: "text-amber-600 dark:text-amber-400", info: "text-sky-600 dark:text-sky-400" };

export default function Dashboard() {
  const me = useMe();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => apiGet<DashboardData>("/dashboard") });
  const d = q.isError ? undefined : q.data;

  return (
    <div>
      <PageHeader
        eyebrow={d ? tanggal(d.today) : "Ringkasan"}
        title={`Selamat bekerja, ${me.data?.name ?? ""}`}
        subtitle="Alur harian: upload mutasi → kategorikan → OK → terbit bukti → laporan."
      />

      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <Stat accent label="Saldo bank (buku)" value={d ? rupiah(d.bank_balance) : "—"} hint="BCA Cab. PIK" testId="kpi-bank-balance" />
        <Stat label="Saldo kas" value={d ? rupiah(d.cash_balance) : "—"} testId="kpi-cash-balance" />
        <Stat label="Donasi masuk bulan ini" value={d ? rupiah(d.donasi_bulan_ini) : "—"} testId="kpi-donasi-bulan-ini" />
        <Stat label="Pengeluaran bulan ini" value={d ? rupiah(d.pengeluaran_bulan_ini) : "—"} hint={d ? `${d.total_donatur} donatur terdaftar` : undefined} testId="kpi-pengeluaran-bulan-ini" />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-12">
        <section className="rounded-xl border bg-card p-5 xl:col-span-5" data-testid="task-queue">
          <h2 className="mb-1 font-semibold">Perlu ditindaklanjuti</h2>
          <p className="mb-4 text-xs text-muted-foreground">Antrean tugas harian</p>
          {!d ? (
            <div className="h-32 animate-pulse rounded-lg bg-muted" />
          ) : d.tasks.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-4 text-sm text-green-800 dark:bg-green-500/10 dark:text-green-300"><CircleCheck className="size-4" /> Semua beres. Tidak ada tugas tertunda.</div>
          ) : (
            <ul className="space-y-2">
              {d.tasks.map((t) => (
                <li key={t.key}>
                  <Link to={t.link} className="group flex items-center gap-3 rounded-lg border px-3 py-3 transition-colors hover:border-primary/40 hover:bg-accent" data-testid={`task-${t.key}`}>
                    {t.severity === "info" ? <Info className={cn("size-4", SEV[t.severity])} /> : <AlertTriangle className={cn("size-4", SEV[t.severity])} />}
                    <span className="text-sm">{t.label}</span>
                    <span className="num ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{t.count}</span>
                    <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-[11px] text-muted-foreground">Bukti pembayaran, dokumen pengeluaran & persetujuan &gt; Rp 20 juta akan muncul di sini pada fase berikutnya.</p>
        </section>

        <section className="rounded-xl border bg-card p-5 xl:col-span-7" data-testid="monthly-chart">
          <h2 className="mb-1 font-semibold">Arus mutasi 6 bulan</h2>
          <p className="mb-4 text-xs text-muted-foreground">Masuk vs keluar (bank + kas)</p>
          <div className="h-64">
            {d && d.monthly.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.monthly} margin={{ left: 8, right: 8 }}>
                  <defs>
                    <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient>
                    <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.3} /><stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tickFormatter={bulan} tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
                  <YAxis tickFormatter={(v: number) => `${Math.round(v / 1e6)}jt`} tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" width={44} />
                  <Tooltip formatter={(v: number, n: string) => [rupiah(v), n === "masuk" ? "Masuk" : "Keluar"]} labelFormatter={(l: string) => bulan(l)} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} />
                  <Area type="monotone" dataKey="masuk" stroke="var(--chart-1)" fill="url(#gIn)" strokeWidth={2} />
                  <Area type="monotone" dataKey="keluar" stroke="var(--chart-2)" fill="url(#gOut)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full animate-pulse rounded-lg bg-muted" />
            )}
          </div>
        </section>
      </div>

      <section className="mt-6" data-testid="program-summary">
        <div className="mb-3 flex items-end justify-between">
          <h2 className="font-semibold">Ringkasan per program</h2>
          <Link to="/program" className="text-sm text-primary hover:underline">Semua program</Link>
        </div>
        {!d ? (
          <div className="h-32 animate-pulse rounded-xl bg-muted" />
        ) : d.programs.length === 0 ? (
          <EmptyState>Belum ada program.</EmptyState>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {d.programs.map((p) => (
              <Link key={p.id} to={`/program/${p.id}`} className="rounded-xl border bg-card p-4 transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-md" data-testid={`program-card-${p.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium">{p.name}</div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{p.kind}</span>
                </div>
                <div className="num mt-3 text-lg">{rupiah(p.collected)}</div>
                <div className="text-xs text-muted-foreground">{p.target ? `dari target ${rupiah(p.target)}` : "tanpa target"}</div>
                {p.target > 0 && <Progress value={(p.collected / p.target) * 100} className="mt-2" />}
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div><div className="text-muted-foreground">Tersalurkan</div><div className="num">{rupiah(p.disbursed)}</div></div>
                  <div><div className="text-muted-foreground">Sisa</div><div className="num">{rupiah(p.remaining)}</div></div>
                  <div><div className="text-muted-foreground">Donatur</div><div className="num">{p.donor_count} org</div></div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
