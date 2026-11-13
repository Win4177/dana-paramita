import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCheck, FileDown, FileStack } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageHeader } from "@/components/common";
import { apiGet, apiPost } from "@/lib/api";
import { can, useMe, useSettings } from "@/lib/auth";
import { errMsg, rupiah, tanggal } from "@/lib/format";
import type { CancelIn, Mutasi, Voucher, VoucherIssueIn, VoucherIssueResult } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS: Record<Voucher["status"], string> = {
  menunggu: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
  disetujui: "bg-green-100 text-green-900 dark:bg-green-500/15 dark:text-green-200",
  batal: "bg-muted text-muted-foreground line-through",
};

export default function Vouchers() {
  const qc = useQueryClient();
  const me = useMe();
  const settings = useSettings();
  const canWrite = can(me.data, "voucher", "write");
  const isAdmin = me.data?.role === "admin";
  const [month, setMonth] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const pending = useQuery({ queryKey: ["vouchers", "pending", month], queryFn: () => apiGet<Mutasi[]>(`/vouchers/pending-mutasi?month=${month}`) });
  const list = useQuery({ queryKey: ["vouchers", "list", month], queryFn: () => apiGet<Voucher[]>(`/vouchers?month=${month}`) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["vouchers"] }); void qc.invalidateQueries({ queryKey: ["mutasi"] }); };
  const issue = useMutation({
    mutationFn: (ids: string[]) => apiPost<VoucherIssueResult>("/vouchers/issue", { mutasi_ids: ids } satisfies VoucherIssueIn),
    onSuccess: (r) => {
      const wait = r.issued.filter((v) => v.status === "menunggu").length;
      toast.success(`${r.issued.length} voucher dibuat${wait ? `, ${wait} menunggu persetujuan` : ""}`);
      setSel(new Set()); refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const approve = useMutation({ mutationFn: (id: string) => apiPost<Voucher>(`/vouchers/${id}/approve`), onSuccess: (v) => { toast.success(`${v.number} disetujui`); refresh(); }, onError: (e) => toast.error(errMsg(e)) });
  const cancel = useMutation({
    mutationFn: (v: Voucher) => apiPost<Voucher>(`/vouchers/${v.id}/cancel`, { reason: window.prompt(`Alasan membatalkan ${v.number}?`) ?? "", reissue: false } satisfies CancelIn),
    onSuccess: (v) => { toast.success(`${v.number} dibatalkan`); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const items = pending.data ?? [];
  const threshold = settings.data?.approval_threshold ?? 20_000_000;
  return (
    <div>
      <PageHeader eyebrow="BKM · BKK · BBM · BBK" title="Voucher" subtitle={`Nomor urut per jenis per bulan (mis. BBK/001/11/2026). Pengeluaran di atas ${rupiah(threshold)} wajib disetujui Admin/Ketua/Bendahara.`}
        actions={<Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-40 bg-card" data-testid="voucher-month-filter" />} />
      <Tabs defaultValue="buat">
        <TabsList className="mb-4">
          <TabsTrigger value="buat" data-testid="tab-voucher-pending">Belum ada voucher ({items.length})</TabsTrigger>
          <TabsTrigger value="daftar" data-testid="tab-voucher-list">Daftar voucher</TabsTrigger>
        </TabsList>
        <TabsContent value="buat">
          {canWrite && <Button className="mb-3" disabled={!sel.size || issue.isPending} onClick={() => issue.mutate([...sel])} data-testid="voucher-issue-button"><FileStack /> Buat {sel.size || ""} voucher</Button>}
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[760px] text-sm" data-testid="voucher-pending-table">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="w-10 px-3 py-2.5">{canWrite && <Checkbox checked={items.length > 0 && items.every((m) => sel.has(m.id))} onCheckedChange={(c) => setSel(c ? new Set(items.map((m) => m.id)) : new Set())} data-testid="voucher-select-all" />}</th><th className="px-2 py-2.5">Tanggal</th><th className="px-2 py-2.5">Jenis</th><th className="px-2 py-2.5">Keterangan</th><th className="px-3 py-2.5 text-right">Nominal</th></tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id} className="border-t" data-testid={`voucher-pending-${m.id}`}>
                    <td className="px-3 py-2">{canWrite && <Checkbox checked={sel.has(m.id)} onCheckedChange={() => setSel((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })} data-testid={`voucher-select-${m.id}`} />}</td>
                    <td className="num px-2 py-2 text-xs">{tanggal(m.date)}</td>
                    <td className="px-2 py-2 text-xs font-medium">{m.voucher_type}{m.direction === "DB" && m.amount > threshold && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-900">perlu persetujuan</span>}</td>
                    <td className="max-w-md truncate px-2 py-2 text-xs">{m.sender_name} · {m.description}</td>
                    <td className="num px-3 py-2 text-right">{rupiah(m.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!pending.isLoading && items.length === 0 && <div className="p-6"><EmptyState>Semua mutasi sudah memiliki voucher.</EmptyState></div>}
          </div>
        </TabsContent>
        <TabsContent value="daftar">
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[820px] text-sm" data-testid="voucher-table">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-4 py-2.5">Nomor</th><th className="px-2 py-2.5">Tanggal</th><th className="px-2 py-2.5">Keterangan</th><th className="px-2 py-2.5 text-right">Nominal</th><th className="px-2 py-2.5">Status</th><th className="px-4 py-2.5 text-right">Aksi</th></tr>
              </thead>
              <tbody>
                {list.data?.map((v) => (
                  <tr key={v.id} className="border-t" data-testid={`voucher-row-${v.id}`}>
                    <td className="num px-4 py-2 text-xs font-medium">{v.number}</td>
                    <td className="num px-2 py-2 text-xs">{tanggal(v.date)}</td>
                    <td className="max-w-sm truncate px-2 py-2 text-xs">{v.party} · {v.description}</td>
                    <td className="num px-2 py-2 text-right">{rupiah(v.amount)}</td>
                    <td className="px-2 py-2"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS[v.status])} data-testid={`voucher-status-${v.id}`}>{v.status}{v.approved_by && ` · ${v.approved_by}`}</span></td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      {isAdmin && v.status === "menunggu" && <Button size="xs" className="mr-1" onClick={() => approve.mutate(v.id)} data-testid={`voucher-approve-${v.id}`}><CheckCheck /> Setujui</Button>}
                      <Button size="xs" variant="outline" className="mr-1" onClick={() => window.open(`/api/vouchers/${v.id}/pdf`, "_blank", "noopener")} data-testid={`voucher-pdf-${v.id}`}><FileDown /> PDF</Button>
                      {can(me.data, "voucher", "delete") && v.status !== "batal" && <Button size="xs" variant="ghost" onClick={() => cancel.mutate(v)} data-testid={`voucher-cancel-${v.id}`}><Ban /> Batal</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.data?.length === 0 && <div className="p-6"><EmptyState>Belum ada voucher.</EmptyState></div>}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
