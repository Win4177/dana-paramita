import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCheck, ClipboardCheck, Copy, Plus, Share2, Trash2, Undo2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, PageHeader, Stat } from "@/components/common";
import { DonorPicker } from "@/components/Pickers";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { can, useMe } from "@/lib/auth";
import { bulan, errMsg, num, parseRupiah, rupiah } from "@/lib/format";
import type { Reminder, CheckIn, CicilanCell, CicilanCellStatus, CicilanMatrix, CicilanMember, CicilanRow, MembersIn, Program } from "@/lib/types";
import { cn } from "@/lib/utils";

const CELL: Record<CicilanCellStatus, { cls: string; label: string }> = {
  lunas: { cls: "bg-green-100 text-green-900 dark:bg-green-500/15 dark:text-green-200", label: "Lunas" },
  lebih: { cls: "bg-emerald-200 text-emerald-950 dark:bg-emerald-500/25 dark:text-emerald-100", label: "Lebih / di luar jadwal" },
  kurang: { cls: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200", label: "Kurang" },
  tunggak: { cls: "bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-200", label: "Tunggak" },
  kosong: { cls: "text-muted-foreground/50", label: "Tidak ada kewajiban" },
  mendatang: { cls: "text-muted-foreground/60", label: "Belum jatuh tempo" },
};
const short = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)}jt` : n >= 1e3 ? `${Math.round(n / 1e3)}rb` : String(n));

function CheckMark({ c }: { c: CicilanCell }) {
  if (c.check === "admin") return <CheckCheck className="size-3 text-primary" aria-label="Dikonfirmasi admin" />;
  if (c.check === "rekan") return <span className="size-1.5 rounded-full bg-sky-500" aria-label="Dicek rekan" />;
  return null;
}

function CellButton({ row, c, pid, isAdmin, canCheck }: { row: CicilanRow; c: CicilanCell; pid: string; isAdmin: boolean; canCheck: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const m = useMutation({
    mutationFn: (b: Omit<CheckIn, "donor_id" | "month">) => apiPost<CicilanCell>(`/cicilan/${pid}/check`, { donor_id: row.donor_id, month: c.month, ...b } satisfies CheckIn),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["cicilan-matrix"] }); setOpen(false); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const testId = `cell-${row.donor_id}-${c.month}`;
  const label = c.paid > 0 ? short(c.paid) : c.status === "tunggak" ? "—" : "";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn("relative flex h-9 w-full min-w-14 items-center justify-center gap-1 rounded-md text-[11px] font-medium transition-[transform,box-shadow] hover:scale-[1.04] hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring", CELL[c.status].cls, c.check === "admin" && "ring-1 ring-primary/60")}
        data-testid={testId}
        data-status={c.status}
        data-check={c.check}
      >
        <span className="num">{label}</span><CheckMark c={c} />
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm" data-testid={`${testId}-popover`}>
        <div className="font-semibold">{row.donor_name}</div>
        <div className="mb-2 text-xs text-muted-foreground">{bulan(c.month)} · {CELL[c.status].label}</div>
        <dl className="mb-3 grid grid-cols-2 gap-1 text-xs">
          <dt className="text-muted-foreground">Kewajiban</dt><dd className="num text-right">{rupiah(c.expected)}</dd>
          <dt className="text-muted-foreground">Disetor</dt><dd className="num text-right">{rupiah(c.paid)}</dd>
          <dt className="text-muted-foreground">Tahap 1 · cek rekan</dt><dd className="text-right">{c.rekan_by || "—"}</dd>
          <dt className="text-muted-foreground">Tahap 2 · admin</dt><dd className="text-right">{c.admin_by || "—"}</dd>
        </dl>
        {canCheck && (
          <div className="flex flex-wrap gap-2">
            {c.check === "belum" && <Button size="sm" onClick={() => m.mutate({ stage: "rekan", undo: false })} disabled={m.isPending} data-testid={`${testId}-check-rekan`}><ClipboardCheck /> Tandai dicek</Button>}
            {c.check === "rekan" && <Button size="sm" variant="ghost" onClick={() => m.mutate({ stage: "rekan", undo: true })} disabled={m.isPending} data-testid={`${testId}-undo-rekan`}><Undo2 /> Batal cek</Button>}
            {isAdmin && c.check === "rekan" && <Button size="sm" onClick={() => m.mutate({ stage: "admin", undo: false })} disabled={m.isPending} data-testid={`${testId}-confirm-admin`}><CheckCheck /> Konfirmasi admin</Button>}
            {isAdmin && c.check === "admin" && <Button size="sm" variant="ghost" onClick={() => m.mutate({ stage: "admin", undo: true })} disabled={m.isPending} data-testid={`${testId}-undo-admin`}><Undo2 /> Batal konfirmasi</Button>}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

type MemberDraft = CicilanMember & { amountText: string };

function MembersDialog({ pid, open, onOpenChange, defaultAmount }: { pid: string; open: boolean; onOpenChange: (o: boolean) => void; defaultAmount: number }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cicilan-members", pid], queryFn: () => apiGet<CicilanMember[]>(`/cicilan/${pid}/members`), enabled: open });
  const [rows, setRows] = useState<MemberDraft[]>([]);
  useEffect(() => { if (q.data && open) setRows(q.data.map((m) => ({ ...m, amountText: num(m.monthly_amount) }))); }, [q.data, open]);
  const done = () => { void qc.invalidateQueries({ queryKey: ["cicilan-matrix"] }); void qc.invalidateQueries({ queryKey: ["cicilan-members", pid] }); };
  const save = useMutation({
    mutationFn: () => apiPut<CicilanMember[]>(`/cicilan/${pid}/members`, { members: rows.filter((r) => r.donor_id).map(({ amountText, ...m }) => ({ ...m, monthly_amount: parseRupiah(amountText) })) } satisfies MembersIn),
    onSuccess: () => { toast.success("Daftar anggota tersimpan"); done(); onOpenChange(false); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const fromPayers = useMutation({
    mutationFn: () => apiPost<CicilanMember[]>(`/cicilan/${pid}/members/from-payers`),
    onSuccess: (r) => { toast.success(`${r.length} anggota terdaftar`); done(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const set = (i: number, patch: Partial<MemberDraft>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl" data-testid="members-dialog">
        <DialogHeader>
          <DialogTitle>Anggota grup cicilan</DialogTitle>
          <DialogDescription>Nominal per bulan dan periode menentukan bulan tunggakan. Penyetor yang belum terdaftar tetap tampil di matriks sebagai “tidak terdaftar”.</DialogDescription>
        </DialogHeader>
        <Button variant="outline" size="sm" className="w-fit" onClick={() => fromPayers.mutate()} disabled={fromPayers.isPending} data-testid="members-from-payers"><UserPlus /> Daftarkan semua penyetor otomatis</Button>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={`${r.donor_id}-${i}`} className="grid grid-cols-[minmax(0,2fr)_7rem_8rem_8rem_2rem] items-center gap-2" data-testid={`member-row-${i}`}>
              <DonorPicker value={r.donor_id || null} label={r.donor_name} onChange={(d) => set(i, { donor_id: d?.id ?? "", donor_name: d ? `${d.name_latin} ${d.name_mandarin}`.trim() : "" })} testId={`member-donor-${i}`} />
              <Input className="num h-8" inputMode="decimal" value={r.amountText} onChange={(e) => set(i, { amountText: e.target.value })} aria-label="Nominal per bulan" data-testid={`member-amount-${i}`} />
              <Input className="h-8" type="month" value={r.start_month} onChange={(e) => set(i, { start_month: e.target.value })} aria-label="Bulan mulai" data-testid={`member-start-${i}`} />
              <Input className="h-8" type="month" value={r.end_month} onChange={(e) => set(i, { end_month: e.target.value })} aria-label="Bulan selesai" data-testid={`member-end-${i}`} />
              <Button size="icon-sm" variant="ghost" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="Hapus" data-testid={`member-remove-${i}`}><Trash2 /></Button>
            </div>
          ))}
          {rows.length === 0 && !q.isLoading && <EmptyState>Belum ada anggota.</EmptyState>}
        </div>
        <Button variant="ghost" size="sm" className="w-fit" onClick={() => setRows((rs) => [...rs, { donor_id: "", donor_name: "", monthly_amount: defaultAmount, amountText: defaultAmount ? num(defaultAmount) : "", start_month: new Date().toISOString().slice(0, 7), end_month: "" }])} data-testid="member-add"><Plus /> Tambah anggota</Button>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || rows.some((r) => r.donor_id && (!parseRupiah(r.amountText) || !r.start_month))} data-testid="members-save">Simpan anggota</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReminderDialog({ pid, open, onOpenChange }: { pid: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const latest = useQuery({ queryKey: ["cicilan-reminder", pid], queryFn: () => apiGet<Reminder | null>(`/cicilan/${pid}/reminder`), enabled: open });
  const qc = useQueryClient();
  const make = useMutation({
    mutationFn: () => apiPost<Reminder>(`/cicilan/${pid}/reminder`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["cicilan-reminder", pid] }),
    onError: (e) => toast.error(errMsg(e)),
  });
  const r = latest.data;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="reminder-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><BellRing className="size-4" /> Pengingat tunggakan</DialogTitle>
          <DialogDescription>Dibuat otomatis tiap tanggal 1 pukul 08.00 WIB. Bisa dibuat ulang kapan saja, lalu salin ke grup WhatsApp.</DialogDescription>
        </DialogHeader>
        {r ? <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted p-3 font-sans text-sm" data-testid="reminder-text">{r.text}</pre> : <EmptyState>Belum ada pengingat. Klik Buat sekarang.</EmptyState>}
        {r && <p className="text-xs text-muted-foreground">Per {bulan(r.month)} · {r.overdue_count} anggota menunggak · {rupiah(r.total_arrears)}</p>}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => make.mutate()} disabled={make.isPending} data-testid="reminder-generate-button"><BellRing /> Buat sekarang</Button>
          <Button variant="outline" disabled={!r} onClick={() => r && navigator.clipboard.writeText(r.text).then(() => toast.success("Teks disalin"), () => toast.error("Gagal menyalin"))} data-testid="reminder-copy-button"><Copy /> Salin</Button>
          <Button disabled={!r} onClick={() => r && window.open(`https://wa.me/?text=${encodeURIComponent(r.text)}`, "_blank", "noopener")} data-testid="reminder-whatsapp-button"><Share2 /> Bagikan WhatsApp</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Cicilan() {
  const me = useMe();
  const isAdmin = me.data?.role === "admin";
  const canCheck = can(me.data, "cicilan", "write");
  const canMembers = can(me.data, "program", "write");
  const programs = useQuery({ queryKey: ["cicilan-programs"], queryFn: () => apiGet<Program[]>("/cicilan/programs") });
  const [pid, setPid] = useState("");
  const [year, setYear] = useState(0);
  const [membersOpen, setMembersOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  useEffect(() => { if (!pid && programs.data?.length) setPid(programs.data[0].id); }, [programs.data, pid]);
  const mx = useQuery({ queryKey: ["cicilan-matrix", pid, year], queryFn: () => apiGet<CicilanMatrix>(`/cicilan/${pid}/matrix?year=${year}`), enabled: !!pid });
  const d = mx.isError ? undefined : mx.data;
  const program = programs.data?.find((p) => p.id === pid);
  const pending = d ? d.rows.reduce((n, r) => n + r.cells.filter((c) => c.paid > 0 && c.check !== "admin").length, 0) : 0;

  return (
    <div>
      <PageHeader
        eyebrow="Grup FU 福 & FU HUI 福慧"
        title="Matriks Cicilan"
        subtitle="Donatur × bulan. Tahap 1: rekan menandai “dicek”. Tahap 2: Admin/Bendahara mengonfirmasi. Merah = tunggak."
        actions={pid && <>
          <Button variant="outline" onClick={() => setReminderOpen(true)} data-testid="open-reminder-button"><BellRing /> Pengingat tunggakan</Button>
          {canMembers && <Button variant="outline" onClick={() => setMembersOpen(true)} data-testid="open-members-button"><Users /> Kelola anggota</Button>}
        </>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={pid} onValueChange={(v: string) => { setPid(v); setYear(0); }}>
          <SelectTrigger className="h-9 w-72 bg-card" data-testid="cicilan-program-select"><SelectValue>{() => program?.name ?? "Pilih program cicilan"}</SelectValue></SelectTrigger>
          <SelectContent>{programs.data?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
        {d && (
          <Select value={String(d.year)} onValueChange={(v: string) => setYear(Number(v))}>
            <SelectTrigger className="h-9 w-28 bg-card" data-testid="cicilan-year-select"><SelectValue /></SelectTrigger>
            <SelectContent>{d.years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          {(["lunas", "kurang", "tunggak", "lebih"] as CicilanCellStatus[]).map((s) => <span key={s} className="flex items-center gap-1"><span className={cn("size-3 rounded", CELL[s].cls)} />{CELL[s].label}</span>)}
          <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-sky-500" />dicek rekan</span>
          <span className="flex items-center gap-1"><CheckCheck className="size-3 text-primary" />dikonfirmasi admin</span>
        </div>
      </div>
      {programs.data?.length === 0 && <EmptyState>Belum ada program berjenis cicilan. Buat di menu Program Donasi.</EmptyState>}
      {d && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={`Kewajiban s/d ${bulan(d.today_month)}`} value={rupiah(d.total_expected)} testId="cicilan-total-expected" />
            <Stat accent label={`Disetor ${d.year}`} value={rupiah(d.total_paid)} testId="cicilan-total-paid" />
            <Stat label="Total tunggakan" value={<span className={d.total_arrears > 0 ? "text-red-600 dark:text-red-400" : ""}>{rupiah(d.total_arrears)}</span>} testId="cicilan-total-arrears" />
            <Stat label="Setoran menunggu konfirmasi" value={pending} testId="cicilan-pending-count" />
          </div>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[1100px] border-separate border-spacing-1 text-sm" data-testid="cicilan-matrix">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left">Anggota</th>
                  {d.months.map((m) => <th key={m} className={cn("px-1 py-2 font-medium", m === d.today_month && "text-primary")}>{bulan(m).split(" ")[0].slice(0, 3)}</th>)}
                  <th className="px-2 py-2 text-right">Disetor</th>
                  <th className="px-3 py-2 text-right">Tunggakan</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.donor_id} data-testid={`cicilan-row-${r.donor_id}`}>
                    <td className="sticky left-0 z-10 max-w-56 bg-card px-3 py-1">
                      <div className="truncate font-medium">{r.donor_name}</div>
                      <div className="text-[11px] text-muted-foreground">{r.registered ? `${rupiah(r.monthly_amount)}/bln · mulai ${r.start_month}` : <span className="text-amber-600">tidak terdaftar</span>}</div>
                    </td>
                    {r.cells.map((c) => <td key={c.month} className="p-0"><CellButton row={r} c={c} pid={d.program_id} isAdmin={isAdmin} canCheck={canCheck} /></td>)}
                    <td className="num px-2 text-right text-xs">{rupiah(r.total_paid)}</td>
                    <td className={cn("num px-3 text-right text-xs font-semibold", r.arrears > 0 && "text-red-600 dark:text-red-400")} data-testid={`cicilan-arrears-${r.donor_id}`}>{r.arrears > 0 ? rupiah(r.arrears) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.rows.length === 0 && <div className="p-6"><EmptyState>Belum ada anggota atau setoran untuk {d.year}. {canMembers && "Klik Kelola anggota."}</EmptyState></div>}
          </div>
        </>
      )}
      {pid && <ReminderDialog pid={pid} open={reminderOpen} onOpenChange={setReminderOpen} />}
      {pid && <MembersDialog pid={pid} open={membersOpen} onOpenChange={setMembersOpen} defaultAmount={program?.monthly_amount ?? 0} />}
    </div>
  );
}
