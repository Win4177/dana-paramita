import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, FileDown, Mail, MailOpen, ReceiptText, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, PageHeader } from "@/components/common";
import { useDebounced } from "@/components/Pickers";
import { apiGet, apiPost } from "@/lib/api";
import { can, useMe, useSettings } from "@/lib/auth";
import { errMsg, rupiah, tanggal } from "@/lib/format";
import type { CancelIn, EligibleItem, EmailResult, IssueIn, IssueResult, Receipt, ReceiptPage, ShareLink } from "@/lib/types";
import { cn } from "@/lib/utils";

const key = (e: EligibleItem) => `${e.mutasi_id}:${e.alloc_index}`;

function openPdf(id: string) {
  window.open(`/api/receipts/${id}/pdf`, "_blank", "noopener");
}

function EligibleTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const settings = useSettings();
  const q = useQuery({ queryKey: ["receipts", "eligible"], queryFn: () => apiGet<EligibleItem[]>("/receipts/eligible") });
  const items = q.isError ? [] : q.data ?? [];
  const [sel, setSel] = useState<Set<string>>(new Set());
  const all = items.length > 0 && items.every((i) => sel.has(key(i)));
  const issue = useMutation({
    mutationFn: (list: EligibleItem[]) => apiPost<IssueResult>("/receipts/issue", { items: list.map((i) => ({ mutasi_id: i.mutasi_id, alloc_index: i.alloc_index })) } satisfies IssueIn),
    onSuccess: (r) => {
      if (r.issued.length) toast.success(`${r.issued.length} bukti terbit: ${r.issued.map((x) => x.number).slice(0, 3).join(", ")}${r.issued.length > 3 ? "…" : ""}`);
      if (r.skipped) toast.warning(`${r.skipped} donasi dilewati (sudah punya bukti atau tidak lagi Sudah OK)`);
      if (r.issued.length === 1) openPdf(r.issued[0].id);
      setSel(new Set());
      void qc.invalidateQueries({ queryKey: ["receipts"] });
      void qc.invalidateQueries({ queryKey: ["mutasi"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const chosen = items.filter((i) => sel.has(key(i)));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">Donasi berstatus <b>Sudah OK</b> yang punya donatur dan belum memiliki bukti. {settings.data?.receipt_merge_same_day && "Donasi donatur yang sama di hari yang sama digabung satu bukti."}</span>
        {canWrite && (
          <Button className="ml-auto" disabled={!chosen.length || issue.isPending} onClick={() => issue.mutate(chosen)} data-testid="bulk-issue-button">
            <ReceiptText /> Terbitkan {chosen.length || ""} bukti terpilih
          </Button>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[760px] text-sm" data-testid="eligible-table">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2.5">{canWrite && <Checkbox checked={all} onCheckedChange={(c) => setSel(c ? new Set(items.map(key)) : new Set())} data-testid="eligible-select-all" />}</th>
              <th className="px-2 py-2.5">Tanggal</th><th className="px-2 py-2.5">Donatur</th><th className="px-2 py-2.5">Program</th><th className="px-2 py-2.5 text-right">Nominal</th><th className="px-3 py-2.5 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={key(i)} className={cn("border-t transition-colors hover:bg-accent/50", sel.has(key(i)) && "bg-amber-50 dark:bg-amber-500/5")} data-testid={`eligible-row-${i.mutasi_id}-${i.alloc_index}`}>
                <td className="px-3 py-2">{canWrite && <Checkbox checked={sel.has(key(i))} onCheckedChange={() => setSel((s) => { const n = new Set(s); if (n.has(key(i))) n.delete(key(i)); else n.add(key(i)); return n; })} data-testid={`eligible-select-${i.mutasi_id}-${i.alloc_index}`} />}</td>
                <td className="num whitespace-nowrap px-2 py-2 text-xs">{tanggal(i.date)}</td>
                <td className="px-2 py-2"><div className="font-medium">{i.donor_name}</div><div className="text-xs text-muted-foreground">via {i.sender_name}</div></td>
                <td className="px-2 py-2 text-xs">{i.program_name || "Donasi umum"} · {i.jenis}</td>
                <td className="num px-2 py-2 text-right">{rupiah(i.amount)}</td>
                <td className="px-3 py-2 text-right">
                  {canWrite && <Button size="xs" variant="outline" disabled={issue.isPending} onClick={() => issue.mutate([i])} data-testid={`issue-one-${i.mutasi_id}-${i.alloc_index}`}><ReceiptText /> Terbitkan</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!q.isLoading && items.length === 0 && <div className="p-6"><EmptyState testId="eligible-empty">Semua donasi Sudah OK sudah memiliki bukti pembayaran.</EmptyState></div>}
      </div>
    </div>
  );
}

function CancelDialog({ receipt, onClose }: { receipt: Receipt | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [reissue, setReissue] = useState(true);
  const m = useMutation({
    mutationFn: () => apiPost<IssueResult>(`/receipts/${receipt!.id}/cancel`, { reason, reissue } satisfies CancelIn),
    onSuccess: (r) => {
      toast.success(r.issued.length ? `Dibatalkan. Bukti pengganti: ${r.issued[0].number}` : "Bukti dibatalkan, donasi kembali ke daftar siap terbit");
      void qc.invalidateQueries({ queryKey: ["receipts"] });
      void qc.invalidateQueries({ queryKey: ["mutasi"] });
      setReason("");
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open={!!receipt} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="cancel-receipt-dialog">
        <DialogHeader>
          <DialogTitle>Batalkan bukti {receipt?.number}?</DialogTitle>
          <DialogDescription>Nomor lama tetap tercatat sebagai DIBATALKAN (tidak dipakai ulang). Tercatat di audit log.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="cancel-reason">Alasan pembatalan</Label>
          <Textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. salah nama donatur" data-testid="cancel-reason-input" />
        </div>
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={reissue} onCheckedChange={setReissue} data-testid="cancel-reissue-switch" /> Langsung terbitkan bukti pengganti dengan nomor baru
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button variant="destructive" disabled={reason.trim().length < 3 || m.isPending} onClick={() => m.mutate()} data-testid="confirm-cancel-receipt"><Ban /> Batalkan bukti</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssuedTab({ canDelete, canWrite }: { canDelete: boolean; canWrite: boolean }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [page, setPage] = useState(0);
  const [cancelling, setCancelling] = useState<Receipt | null>(null);
  const list = useQuery({ queryKey: ["receipts", "list", dq, page], queryFn: () => apiGet<ReceiptPage>(`/receipts?q=${encodeURIComponent(dq)}&skip=${page * 50}&limit=50`), placeholderData: keepPreviousData });
  const data = list.isError ? undefined : list.data;
  const email = useMutation({
    mutationFn: (id: string) => apiPost<EmailResult>(`/receipts/${id}/email`),
    onSuccess: (r) => toast.success(`Bukti terkirim ke ${r.sent_to}`),
    onError: (e) => toast.error(errMsg(e)),
  });
  const mailApp = useMutation({
    mutationFn: (id: string) => apiPost<ShareLink>(`/receipts/${id}/share-link`),
    onSuccess: (l) => { window.location.href = `mailto:${encodeURIComponent(l.email)}?subject=${encodeURIComponent(l.subject)}&body=${encodeURIComponent(l.body)}`; },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <div>
      <div className="relative mb-3 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Cari nomor bukti atau donatur" className="bg-card pl-9" data-testid="receipt-search-input" />
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[820px] text-sm" data-testid="receipts-table">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-4 py-2.5">Nomor</th><th className="px-2 py-2.5">Terbit</th><th className="px-2 py-2.5">Donatur</th><th className="px-2 py-2.5">Program</th><th className="px-2 py-2.5 text-right">Nominal</th><th className="px-4 py-2.5 text-right">Aksi</th></tr>
          </thead>
          <tbody>
            {data?.items.map((r) => (
              <tr key={r.id} className={cn("border-t", r.status === "batal" && "text-muted-foreground")} data-testid={`receipt-row-${r.id}`}>
                <td className="num px-4 py-2 text-xs">
                  <span className={cn(r.status === "batal" && "line-through")} data-testid={`receipt-number-${r.id}`}>{r.number}</span>
                  {r.status === "batal" && <div className="text-[10px] font-semibold text-red-600" title={r.cancel_reason}>DIBATALKAN · {r.cancel_reason}</div>}
                  {r.replaces && <div className="text-[10px] text-primary">pengganti</div>}
                </td>
                <td className="num whitespace-nowrap px-2 py-2 text-xs">{tanggal(r.issued_date)}</td>
                <td className="px-2 py-2"><div className="font-medium">{r.donor_name}</div>{r.npwp && <div className="text-xs text-muted-foreground">NPWP {r.npwp}</div>}</td>
                <td className="px-2 py-2 text-xs">{r.program_names.join(", ")}</td>
                <td className="num px-2 py-2 text-right">{rupiah(r.amount)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right">
                  <Button size="xs" variant="outline" className="mr-1" onClick={() => openPdf(r.id)} data-testid={`receipt-pdf-${r.id}`}><FileDown /> PDF</Button>
                  {canWrite && r.status === "aktif" && (
                    <>
                      <Button size="xs" variant="outline" className="mr-1" disabled={email.isPending} onClick={() => email.mutate(r.id)} title="Kirim email berisi tautan unduh PDF (berlaku 30 hari)" data-testid={`receipt-email-${r.id}`}><Mail /> Email</Button>
                      <Button size="icon-sm" variant="ghost" className="mr-1" disabled={mailApp.isPending} onClick={() => mailApp.mutate(r.id)} title="Buka aplikasi email dengan isi siap kirim" aria-label="Buka aplikasi email" data-testid={`receipt-mailapp-${r.id}`}><MailOpen /></Button>
                    </>
                  )}
                  {canDelete && r.status === "aktif" && <Button size="xs" variant="ghost" onClick={() => setCancelling(r)} data-testid={`receipt-cancel-${r.id}`}><Ban /> Batalkan</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.items.length === 0 && <div className="p-6"><EmptyState>Belum ada bukti yang diterbitkan.</EmptyState></div>}
      </div>
      {data && data.total > 50 && (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Sebelumnya</Button>
          <Button size="sm" variant="outline" disabled={(page + 1) * 50 >= data.total} onClick={() => setPage((p) => p + 1)}>Berikutnya</Button>
        </div>
      )}
      <CancelDialog receipt={cancelling} onClose={() => setCancelling(null)} />
    </div>
  );
}

export default function Receipts() {
  const me = useMe();
  const [tab, setTab] = useState("siap");
  return (
    <div>
      <PageHeader
        eyebrow="Tanda terima donasi"
        title="Bukti Pembayaran"
        subtitle="Nomor urut dibuat atomik (tidak pernah dobel atau dipakai ulang). PDF memuat nama Mandarin, logo, dan tanda tangan dari Pengaturan."
      />
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList className="mb-4">
          <TabsTrigger value="siap" data-testid="tab-eligible">Siap diterbitkan</TabsTrigger>
          <TabsTrigger value="terbit" data-testid="tab-issued">Sudah terbit</TabsTrigger>
        </TabsList>
        <TabsContent value="siap"><EligibleTab canWrite={can(me.data, "bukti", "write")} /></TabsContent>
        <TabsContent value="terbit"><IssuedTab canDelete={can(me.data, "bukti", "delete")} canWrite={can(me.data, "bukti", "write")} /></TabsContent>
      </Tabs>
    </div>
  );
}
