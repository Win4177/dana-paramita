import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, PageHeader, Progress, Stat } from "@/components/common";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { can, useMe } from "@/lib/auth";
import { bulan, errMsg, num, parseRupiah, rupiah } from "@/lib/format";
import type { Program, ProgramDetail as Detail, ProgramIn } from "@/lib/types";

const EMPTY: ProgramIn = { name: "", name_mandarin: "", description: "", kind: "donasi", target: 0, start_date: "", end_date: "", status: "aktif", pic: "", monthly_amount: 0 };

function ProgramFormDialog({ open, onOpenChange, program }: { open: boolean; onOpenChange: (o: boolean) => void; program?: Program | null }) {
  const qc = useQueryClient();
  const [f, setF] = useState<ProgramIn>(EMPTY);
  const [target, setTarget] = useState("");
  const [monthly, setMonthly] = useState("");
  useEffect(() => {
    if (!open) return;
    const base = program ? { ...EMPTY, ...program } : EMPTY;
    setF(base);
    setTarget(base.target ? num(base.target) : "");
    setMonthly(base.monthly_amount ? num(base.monthly_amount) : "");
  }, [open, program]);
  const save = useMutation({
    mutationFn: () => {
      const body: ProgramIn = { ...f, target: parseRupiah(target), monthly_amount: parseRupiah(monthly) };
      return program ? apiPut<Program>(`/programs/${program.id}`, body) : apiPost<Program>("/programs", body);
    },
    onSuccess: () => { toast.success("Program tersimpan"); void qc.invalidateQueries({ queryKey: ["programs"] }); void qc.invalidateQueries({ queryKey: ["program"] }); void qc.invalidateQueries({ queryKey: ["dashboard"] }); onOpenChange(false); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const text = (k: "name" | "name_mandarin" | "pic" | "start_date" | "end_date", label: string, type = "text") => (
    <div className="space-y-1.5">
      <Label htmlFor={`program-${k}`}>{label}</Label>
      <Input id={`program-${k}`} type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`program-form-${k}`} />
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl" data-testid="program-form-dialog">
        <DialogHeader><DialogTitle>{program ? "Ubah program" : "Program baru"}</DialogTitle></DialogHeader>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          {text("name", "Nama program")}
          {text("name_mandarin", "Nama Mandarin")}
          <div className="space-y-1.5">
            <Label>Jenis</Label>
            <Select value={f.kind} onValueChange={(v: string) => setF({ ...f, kind: v as ProgramIn["kind"] })}>
              <SelectTrigger className="w-full" data-testid="program-form-kind"><SelectValue>{(v) => (v === "cicilan" ? "Program cicilan (grup)" : "Donasi program")}</SelectValue></SelectTrigger>
              <SelectContent><SelectItem value="donasi">Donasi program</SelectItem><SelectItem value="cicilan">Program cicilan (grup)</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={f.status} onValueChange={(v: string) => setF({ ...f, status: v as ProgramIn["status"] })}>
              <SelectTrigger className="w-full" data-testid="program-form-status"><SelectValue>{(v) => (v === "aktif" ? "Aktif" : "Selesai")}</SelectValue></SelectTrigger>
              <SelectContent><SelectItem value="aktif">Aktif</SelectItem><SelectItem value="selesai">Selesai</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="program-target">Target dana (Rp)</Label>
            <Input id="program-target" inputMode="decimal" className="num" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="program-form-target" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="program-monthly">Nominal standar / bulan (cicilan)</Label>
            <Input id="program-monthly" inputMode="decimal" className="num" value={monthly} onChange={(e) => setMonthly(e.target.value)} data-testid="program-form-monthly" />
          </div>
          {text("start_date", "Mulai", "date")}
          {text("end_date", "Selesai", "date")}
          {text("pic", "Penanggung jawab")}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="program-desc">Deskripsi</Label>
            <Textarea id="program-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} data-testid="program-form-description" />
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Batal</Button>
            <Button type="submit" disabled={save.isPending || !f.name.trim()} data-testid="program-form-submit">Simpan</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Programs() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["programs", "list"], queryFn: () => apiGet<Program[]>("/programs") });
  const programs = q.isError ? [] : q.data ?? [];
  return (
    <div>
      <PageHeader
        eyebrow="Program"
        title="Program Donasi & Cicilan"
        subtitle="Target, dana terkumpul, tersalurkan (dari mutasi keluar yang dikaitkan ke program), sisa, dan jumlah donatur."
        actions={can(me.data, "program", "write") && <Button onClick={() => setOpen(true)} data-testid="add-program-button"><Plus /> Program baru</Button>}
      />
      {q.isLoading && <div className="h-40 animate-pulse rounded-xl bg-muted" />}
      {!q.isLoading && programs.length === 0 && <EmptyState>Belum ada program.</EmptyState>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {programs.map((p, i) => (
          <Link key={p.id} to={`/program/${p.id}`} style={{ animationDelay: `${i * 40}ms` }} className="animate-rise rounded-xl border bg-card p-5 transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-md" data-testid={`program-item-${p.id}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.description}</div>
              </div>
              <span className={p.status === "aktif" ? "rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800 dark:bg-green-500/15 dark:text-green-300" : "rounded-full bg-muted px-2 py-0.5 text-[10px]"}>{p.status}</span>
            </div>
            <div className="num mt-4 text-xl">{rupiah(p.collected)}</div>
            <div className="text-xs text-muted-foreground">{p.target ? `${((p.collected / p.target) * 100).toFixed(1)}% dari ${rupiah(p.target)}` : "tanpa target"}</div>
            {p.target > 0 && <Progress value={(p.collected / p.target) * 100} className="mt-2" />}
            <div className="mt-3 flex justify-between text-xs text-muted-foreground"><span>{p.kind === "cicilan" ? "Cicilan grup" : "Donasi"}</span><span>{p.donor_count} donatur</span></div>
          </Link>
        ))}
      </div>
      <ProgramFormDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

export function ProgramDetail() {
  const { id } = useParams();
  const me = useMe();
  const [edit, setEdit] = useState(false);
  const q = useQuery({ queryKey: ["program", id], queryFn: () => apiGet<Detail>(`/programs/${id}`) });
  const d = q.isError ? undefined : q.data;
  const p = d?.program;
  return (
    <div>
      <Link to="/program" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Program</Link>
      <PageHeader
        eyebrow={p ? (p.kind === "cicilan" ? "Program cicilan" : "Program donasi") : "Program"}
        title={<span data-testid="program-detail-name">{p ? <>{p.name} <span className="font-normal text-muted-foreground">{p.name_mandarin}</span></> : "…"}</span>}
        subtitle={p?.description}
        actions={p && can(me.data, "program", "write") && <Button variant="outline" onClick={() => setEdit(true)} data-testid="edit-program-button"><Pencil /> Ubah</Button>}
      />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Stat label="Target" value={rupiah(p?.target ?? 0)} testId="program-target" />
        <Stat accent label="Terkumpul" value={rupiah(p?.collected ?? 0)} testId="program-collected" />
        <Stat label="Tersalurkan" value={rupiah(p?.disbursed ?? 0)} testId="program-disbursed" />
        <Stat label="Sisa dana" value={rupiah(p?.remaining ?? 0)} testId="program-remaining" />
        <Stat label="Donatur" value={`${p?.donor_count ?? 0} orang`} testId="program-donor-count" />
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-[2fr_1fr]">
        <section className="rounded-xl border bg-card p-5" data-testid="program-monthly-chart">
          <h2 className="mb-4 font-semibold">Per bulan</h2>
          <div className="h-64">
            {d && d.monthly.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tickFormatter={bulan} tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
                  <YAxis tickFormatter={(v: number) => `${(v / 1e6).toFixed(1)}jt`} tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" width={48} />
                  <Tooltip formatter={(v: number, n: string) => [rupiah(v), n === "masuk" ? "Terkumpul" : "Tersalurkan"]} labelFormatter={(l: string) => bulan(l)} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} />
                  <Bar dataKey="masuk" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="keluar" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState>Belum ada data bulanan.</EmptyState>}
          </div>
        </section>
        <section className="rounded-xl border bg-card p-5" data-testid="program-top-donors">
          <h2 className="mb-3 font-semibold">Donatur teratas</h2>
          {d?.top_donors.length ? (
            <ol className="space-y-2 text-sm">
              {d.top_donors.map((t) => (
                <li key={t.donor_id} className="flex justify-between gap-2">
                  <Link to={`/donatur/${t.donor_id}`} className="truncate hover:text-primary hover:underline">{t.name}</Link>
                  <span className="num shrink-0">{rupiah(t.total)}</span>
                </li>
              ))}
            </ol>
          ) : <EmptyState>Belum ada donatur.</EmptyState>}
          <p className="mt-4 text-xs text-muted-foreground">Unduh laporan program (Excel/PDF) tersedia pada fase Laporan.</p>
        </section>
      </div>
      {p && <ProgramFormDialog open={edit} onOpenChange={setEdit} program={p} />}
    </div>
  );
}
