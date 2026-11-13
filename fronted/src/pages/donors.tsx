import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, GitMerge, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, PageHeader } from "@/components/common";
import { useDebounced } from "@/components/Pickers";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { can, useMe } from "@/lib/auth";
import { errMsg, rupiah } from "@/lib/format";
import type { Donor, DonorIn, DuplicateGroup } from "@/lib/types";

const EMPTY: DonorIn = { name_latin: "", name_mandarin: "", alias: "", phone: "", address: "", npwp: "", email: "", bank_accounts: [], pic: "", notes: "" };

export function DonorFormDialog({ open, onOpenChange, donor }: { open: boolean; onOpenChange: (o: boolean) => void; donor?: Donor | null }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<DonorIn>(EMPTY);
  const [accounts, setAccounts] = useState("");
  useEffect(() => {
    if (!open) return;
    const base = donor ? { ...EMPTY, ...donor } : EMPTY;
    setForm(base);
    setAccounts(base.bank_accounts.join(", "));
  }, [open, donor]);

  const save = useMutation({
    mutationFn: () => {
      const body: DonorIn = { ...form, bank_accounts: accounts.split(",").map((s) => s.trim()).filter(Boolean) };
      return donor ? apiPut<Donor>(`/donors/${donor.id}`, body) : apiPost<Donor>("/donors", body);
    },
    onSuccess: () => {
      toast.success(donor ? "Donatur diperbarui" : "Donatur ditambahkan");
      void qc.invalidateQueries({ queryKey: ["donors"] });
      void qc.invalidateQueries({ queryKey: ["donor"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const field = (k: keyof DonorIn, label: string, props: Record<string, string> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`donor-${k}`}>{label}</Label>
      <Input id={`donor-${k}`} value={form[k] as string} onChange={(e) => setForm({ ...form, [k]: e.target.value })} data-testid={`donor-form-${k}`} {...props} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl" data-testid="donor-form-dialog">
        <DialogHeader>
          <DialogTitle>{donor ? "Ubah donatur" : "Tambah donatur"}</DialogTitle>
          <DialogDescription>Nama Mandarin (繁體/简体) dan nama Latin disimpan terpisah; pinyin dibuat otomatis untuk pencarian.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          {field("name_latin", "Nama Latin / pinyin")}
          {field("name_mandarin", "Nama Mandarin 中文名")}
          {field("alias", "Alias")}
          {field("phone", "Kontak / HP")}
          {field("npwp", "NPWP (opsional, terenkripsi)")}
          {field("email", "Email (untuk kirim bukti pembayaran)")}
          {field("pic", "PIC / penanggung jawab")}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="donor-accounts">Nama rekening pengirim (pisahkan dengan koma)</Label>
            <Input id="donor-accounts" value={accounts} onChange={(e) => setAccounts(e.target.value)} placeholder="MARIATI, EDY" data-testid="donor-form-bank_accounts" />
            <p className="text-xs text-muted-foreground">Satu rekening bisa dipakai banyak donatur (titipan/keluarga).</p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="donor-address">Alamat</Label>
            <Textarea id="donor-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} data-testid="donor-form-address" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="donor-notes">Catatan</Label>
            <Textarea id="donor-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="donor-form-notes" />
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Batal</Button>
            <Button type="submit" disabled={save.isPending} data-testid="donor-form-submit">{save.isPending ? "Menyimpan…" : "Simpan"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DuplicatesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const dups = useQuery({ queryKey: ["donors", "duplicates"], queryFn: () => apiGet<DuplicateGroup[]>("/donors/duplicates"), enabled: open });
  const [target, setTarget] = useState<Record<string, string>>({});
  const aiCheck = useMutation({ mutationFn: () => apiPost<DuplicateGroup[]>("/donors/duplicates/ai-check"), onError: (e) => toast.error(errMsg(e)) });
  const groups = [...(dups.data ?? []), ...(aiCheck.data ?? [])];
  const merge = useMutation({
    mutationFn: (g: DuplicateGroup) => {
      const t = target[g.key] ?? g.donors[0].id;
      return apiPost<Donor>("/donors/merge", { target_id: t, source_ids: g.donors.map((d) => d.id).filter((id) => id !== t) });
    },
    onSuccess: () => { toast.success("Donatur digabung"); void qc.invalidateQueries({ queryKey: ["donors"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" data-testid="duplicates-dialog">
        <DialogHeader>
          <DialogTitle>Deteksi duplikat donatur</DialogTitle>
          <DialogDescription>Pilih data utama, lalu gabungkan. Riwayat donasi & rekening ikut dipindahkan.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3 text-sm">
          <span className="flex-1 text-muted-foreground">Nama sama persis sudah dicek. AI juga bisa menilai ejaan berbeda (pinyin, alias, 繁/简).</span>
          <Button size="sm" variant="outline" onClick={() => aiCheck.mutate()} disabled={aiCheck.isPending} data-testid="ai-duplicates-button"><Bot /> {aiCheck.isPending ? "AI memeriksa…" : "Periksa dengan AI"}</Button>
        </div>
        {dups.data && groups.length === 0 && <EmptyState>{aiCheck.isSuccess ? "AI juga tidak menemukan indikasi duplikat." : "Tidak ada indikasi duplikat."}</EmptyState>}
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.key} className="rounded-lg border p-3" data-testid={`duplicate-group-${g.key}`}>
              {g.ai_score != null && <div className="mb-1 inline-flex items-center gap-1 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 dark:bg-sky-500/15 dark:text-sky-300" data-testid="duplicate-ai-score"><Bot className="size-3" />AI: {Math.round(g.ai_score * 100)}% kemungkinan orang yang sama</div>}
              {g.donors.map((d) => (
                <label key={d.id} className="flex items-center gap-2 py-1 text-sm">
                  <input type="radio" name={g.key} checked={(target[g.key] ?? g.donors[0].id) === d.id} onChange={() => setTarget({ ...target, [g.key]: d.id })} />
                  {d.name_latin} {d.name_mandarin} <span className="text-xs text-muted-foreground">· {d.bank_accounts.join(", ") || "tanpa rekening"}</span>
                </label>
              ))}
              <Button size="sm" className="mt-2" onClick={() => merge.mutate(g)} disabled={merge.isPending} data-testid={`merge-button-${g.key}`}><GitMerge /> Gabungkan</Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Donors() {
  const me = useMe();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => setQ(params.get("q") ?? ""), [params]);
  const dq = useDebounced(q);
  const [formOpen, setFormOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const list = useQuery({ queryKey: ["donors", "list", dq], queryFn: () => apiGet<Donor[]>(`/donors?q=${encodeURIComponent(dq)}`) });
  const donors = list.isError ? [] : list.data ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="Master data"
        title="Donatur"
        subtitle="Cari lintas nama Latin, Mandarin (繁/简), dan pinyin. Klik nama untuk melihat profil & riwayat donasi."
        actions={
          <>
            {can(me.data, "donatur", "delete") && <Button variant="outline" onClick={() => setDupOpen(true)} data-testid="open-duplicates-button"><GitMerge /> Cek duplikat</Button>}
            {can(me.data, "donatur", "write") && <Button onClick={() => setFormOpen(true)} data-testid="add-donor-button"><Plus /> Tambah donatur</Button>}
          </>
        }
      />
      <div className="relative mb-4 max-w-lg">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="mis. Fang, 方, fang, xu, 許…" className="h-10 bg-card pl-9" data-testid="donor-search-input" />
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm" data-testid="donor-table">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Nama</th>
                <th className="px-3 py-2.5">中文 / pinyin</th>
                <th className="px-3 py-2.5">Rekening pengirim</th>
                <th className="px-3 py-2.5">PIC</th>
                <th className="px-3 py-2.5 text-right">Kali donasi</th>
                <th className="px-4 py-2.5 text-right">Total donasi</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading && <tr><td colSpan={6} className="p-4"><div className="h-6 animate-pulse rounded bg-muted" /></td></tr>}
              {donors.map((d) => (
                <tr key={d.id} className="border-t transition-colors hover:bg-accent/60" data-testid={`donor-row-${d.id}`}>
                  <td className="px-4 py-2.5">
                    <Link to={`/donatur/${d.id}`} className="font-medium hover:text-primary hover:underline" data-testid={`donor-link-${d.id}`}>{d.name_latin || d.name_mandarin}</Link>
                    {d.npwp && <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 dark:bg-sky-500/15 dark:text-sky-300">NPWP</span>}
                  </td>
                  <td className="px-3 py-2.5"><span className="text-base">{d.name_mandarin}</span> <span className="text-xs text-muted-foreground">{d.name_pinyin}</span></td>
                  <td className="px-3 py-2.5 text-xs">{d.bank_accounts.join(", ") || "—"}</td>
                  <td className="px-3 py-2.5 text-xs">{d.pic || "—"}</td>
                  <td className="num px-3 py-2.5 text-right">{d.donation_count}</td>
                  <td className="num px-4 py-2.5 text-right font-medium">{rupiah(d.total_donasi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.isLoading && donors.length === 0 && <div className="p-6"><EmptyState testId="donor-empty">Tidak ada donatur yang cocok.</EmptyState></div>}
      </div>
      <DonorFormDialog open={formOpen} onOpenChange={setFormOpen} />
      <DuplicatesDialog open={dupOpen} onOpenChange={setDupOpen} />
    </div>
  );
}
