import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bot, Camera, Check, Lock, Download, History, Landmark, Paperclip, Search, Sparkles, Split, Trash2, Upload, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, PageHeader, STATUS_META } from "@/components/common";
import { DonorPicker, ProgramSelect, useDebounced } from "@/components/Pickers";
import SplitDialog from "@/components/SplitDialog";
import UploadDialog from "@/components/UploadDialog";
import { AttachmentsDialog } from "@/components/Attachments";
import NotaReaderDialog from "@/components/NotaReader";
import { apiDelete, apiDownload, apiGet, apiPatch, apiPost } from "@/lib/api";
import { can, useMe } from "@/lib/auth";
import { errMsg, rupiah, tanggal, waktu } from "@/lib/format";
import type { AiAnalyzeResult, ImportRecord, Jenis, Mutasi, MutasiPage, MutasiPatch, MutasiStatus, Reconciliation } from "@/lib/types";
import { cn } from "@/lib/utils";

const ALL = "all";
const PAGE = 50;
const JENIS_SHORT: Record<Jenis, string> = { donasi: "Donasi", cicilan: "Cicilan", lainnya: "Lainnya" };

export const AI_CATEGORY_LABEL: Record<string, string> = {
  donasi: "Donasi", cicilan: "Cicilan", pengeluaran_operasional: "Operasional", gaji: "Gaji",
  biaya_bank: "Bank (biaya/bunga)", transfer_internal: "Transfer internal", lainnya: "Lainnya",
};

function ImportsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const q = useQuery({ queryKey: ["mutasi-imports"], queryFn: () => apiGet<ImportRecord[]>("/mutasi/imports"), enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" data-testid="imports-dialog">
        <DialogHeader>
          <DialogTitle>Riwayat impor & file asli</DialogTitle>
          <DialogDescription>Setiap file mutasi yang diunggah diarsipkan apa adanya dan bisa diunduh kembali.</DialogDescription>
        </DialogHeader>
        {q.data?.length === 0 && <EmptyState>Belum ada impor.</EmptyState>}
        <ul className="space-y-2 text-sm">
          {q.data?.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2" data-testid={`import-row-${r.id}`}>
              <div className="min-w-0">
                <div className="truncate font-medium">{r.filename}</div>
                <div className="text-xs text-muted-foreground">{waktu(r.at)} · {r.user} · {r.inserted} baru, {r.updated} diperbarui, {r.duplicates} duplikat</div>
              </div>
              {r.file_id ? (
                <Button size="sm" variant="outline" onClick={() => void apiDownload(`/files/${r.file_id}`, r.filename).catch((e: unknown) => toast.error(errMsg(e)))} data-testid={`import-download-${r.id}`}><Download /> File asli</Button>
              ) : <span className="text-xs text-muted-foreground">tidak diarsipkan</span>}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function ReconciliationCard() {
  const q = useQuery({ queryKey: ["reconciliation", "bank"], queryFn: () => apiGet<Reconciliation>("/mutasi/reconciliation?channel=bank") });
  const r = q.isError ? undefined : q.data;
  const ok = r?.difference != null && Math.abs(r.difference) < 0.01;
  return (
    <div className="rounded-xl border bg-card p-4" data-testid="reconciliation-card">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold">Rekonsiliasi bank</div>
        {r?.difference != null && (
          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", ok ? "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300" : "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300")} data-testid="reconciliation-status">
            {ok ? "Klop / Seimbang" : `Selisih ${rupiah(r.difference)}`}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <dt className="text-muted-foreground">Saldo akhir mutasi{r?.last_date ? ` (${tanggal(r.last_date)})` : ""}</dt>
        <dd className="num text-right" data-testid="reconciliation-bank-balance">{rupiah(r?.bank_balance)}</dd>
        <dt className="text-muted-foreground">Saldo buku (saldo awal + masuk − keluar)</dt>
        <dd className="num text-right" data-testid="reconciliation-book-balance">{rupiah(r?.book_balance)}</dd>
      </dl>
    </div>
  );
}

const items0 = (d: MutasiPage | undefined) => d?.items ?? [];

export default function MutasiPage() {
  const qc = useQueryClient();
  const me = useMe();
  const canWrite = can(me.data, "mutasi", "write");
  const canDelete = can(me.data, "mutasi", "delete");
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [status, setStatus] = useState(params.get("status") ?? ALL);
  const [direction, setDirection] = useState(ALL);
  const [flag, setFlag] = useState(params.get("uncategorized") ? "uncategorized" : params.get("suggested") ? "suggested" : params.get("janggal") ? "janggal" : ALL);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [splitting, setSplitting] = useState<Mutasi | null>(null);
  const [deleting, setDeleting] = useState<Mutasi | null>(null);
  const [uploadOpen, setUploadOpen] = useState(params.get("upload") === "1");
  const [attachFor, setAttachFor] = useState<string | null>(null);
  const [importsOpen, setImportsOpen] = useState(false);
  const [notaOpen, setNotaOpen] = useState(false);

  useEffect(() => {
    if (params.get("upload") === "1") {
      setUploadOpen(true);
      params.delete("upload");
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "u" && (e.ctrlKey || e.metaKey) && canWrite) {
        e.preventDefault();
        setUploadOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canWrite]);

  const filterQs = () => {
    const s = new URLSearchParams();
    if (dq) s.set("q", dq);
    if (status !== ALL) s.set("status", status);
    if (direction !== ALL) s.set("direction", direction);
    if (flag === "uncategorized") s.set("uncategorized", "true");
    if (flag === "suggested") s.set("suggested", "true");
    if (flag === "janggal") s.set("janggal", "true");
    if (dateFrom) s.set("date_from", dateFrom);
    if (dateTo) s.set("date_to", dateTo);
    return s;
  };
  const qs = filterQs();
  qs.set("skip", String(page * PAGE));
  qs.set("limit", String(PAGE));
  const list = useQuery({
    queryKey: ["mutasi", qs.toString()],
    queryFn: () => apiGet<MutasiPage>(`/mutasi?${qs}`),
    placeholderData: keepPreviousData,
    // fresh imports are analysed by AI in the background; poll until every visible row has a result
    refetchInterval: (query) => (query.state.data?.items.some((m) => m.ai_status === "") ? 4000 : false),
  });
  const data = list.isError ? undefined : list.data;

  useEffect(() => setPage(0), [dq, status, direction, flag, dateFrom, dateTo]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["mutasi"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
    void qc.invalidateQueries({ queryKey: ["reconciliation"] });
  };
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: MutasiPatch }) => apiPatch<Mutasi>(`/mutasi/${id}`, body),
    onSuccess: refresh,
    onError: (e) => toast.error(errMsg(e)),
  });
  const confirm = useMutation({
    mutationFn: (id: string) => apiPost<Mutasi>(`/mutasi/${id}/confirm`),
    onSuccess: () => { toast.success("Saran dikonfirmasi"); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const bulk = useMutation({
    mutationFn: (s: MutasiStatus) => apiPost<{ updated: number }>("/mutasi/bulk-status", { ids: [...selected], status: s }),
    onSuccess: (r) => { toast.success(`${r.updated} mutasi diperbarui`); setSelected(new Set()); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/mutasi/${id}`),
    onSuccess: () => { toast.success("Mutasi dihapus (tercatat di audit log)"); setDeleting(null); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });

  const ai = useMutation({
    mutationFn: () => apiPost<AiAnalyzeResult>("/mutasi/ai-analyze", { ids: [], only_new: true }),
    onSuccess: (r) => {
      if (r.processed === 0) toast.info("Semua mutasi sudah dianalisis AI");
      else toast.success(`AI menganalisis ${r.processed} mutasi: ${r.matched} donatur dicocokkan, ${r.flagged} ditandai perlu cek${r.failed ? `, ${r.failed} gagal (coba lagi)` : ""}`);
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const attachMutasi = items0(data).find((m) => m.id === attachFor) ?? null;

  const exportXlsx = async (onlyOk: boolean) => {
    const s = filterQs();
    if (onlyOk) s.set("status", "ok");
    try {
      await apiDownload(`/mutasi/export?${s}`, "mutasi.xlsx");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const items = data?.items ?? [];
  const allSelected = items.length > 0 && items.every((m) => selected.has(m.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div>
      <PageHeader
        eyebrow="Inti aplikasi"
        title="Mutasi Rekening"
        subtitle="Upload mutasi BCA, kategorikan per donatur & program, split, lalu tandai OK. Saran otomatis dipelajari dari riwayat."
        actions={
          <>
            <Button variant="outline" onClick={() => setImportsOpen(true)} data-testid="open-imports-button"><History /> Riwayat impor</Button>
            {canWrite && <Button variant="outline" onClick={() => setNotaOpen(true)} data-testid="open-nota-reader-button"><Camera /> Baca foto nota</Button>}
            {canWrite && <Button variant="outline" onClick={() => ai.mutate()} disabled={ai.isPending} data-testid="ai-analyze-button"><Bot /> {ai.isPending ? "AI menganalisis…" : "Analisis AI"}</Button>}
            <Button variant="outline" onClick={() => void exportXlsx(true)} data-testid="export-ok-button"><Download /> Export (Sudah OK)</Button>
            <Button variant="outline" onClick={() => void exportXlsx(false)} data-testid="export-all-button"><Download /> Export filter</Button>
            {canWrite && <Button onClick={() => setUploadOpen(true)} data-testid="open-upload-button"><Upload /> Upload mutasi</Button>}
          </>
        }
      />

      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_380px]">
        <div className="rounded-xl border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-52 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari keterangan, pengirim, donatur, nominal…" className="h-9 pl-8" data-testid="mutasi-search-input" />
            </div>
            <Select value={status} onValueChange={(v: string) => setStatus(v)}>
              <SelectTrigger className="h-9 w-36" data-testid="filter-status"><SelectValue>{(v) => (v === ALL ? "Semua status" : STATUS_META[v as MutasiStatus].label)}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Semua status</SelectItem>
                {(Object.keys(STATUS_META) as MutasiStatus[]).map((s) => <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={direction} onValueChange={(v: string) => setDirection(v)}>
              <SelectTrigger className="h-9 w-32" data-testid="filter-direction"><SelectValue>{(v) => ({ all: "Masuk & keluar", CR: "Masuk (CR)", DB: "Keluar (DB)" } as Record<string, string>)[v as string]}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Masuk & keluar</SelectItem>
                <SelectItem value="CR">Masuk (CR)</SelectItem>
                <SelectItem value="DB">Keluar (DB)</SelectItem>
              </SelectContent>
            </Select>
            <Select value={flag} onValueChange={(v: string) => setFlag(v)}>
              <SelectTrigger className="h-9 w-44" data-testid="filter-flag"><SelectValue>{(v) => ({ all: "Semua mutasi", uncategorized: "Belum dikategorikan", suggested: "Saran menunggu", janggal: "Janggal menurut AI" } as Record<string, string>)[v as string]}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Semua mutasi</SelectItem>
                <SelectItem value="uncategorized">Belum dikategorikan</SelectItem>
                <SelectItem value="suggested">Saran menunggu</SelectItem>
                <SelectItem value="janggal" data-testid="filter-flag-janggal">Janggal menurut AI</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-36" data-testid="filter-date-from" aria-label="Dari tanggal" />
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-36" data-testid="filter-date-to" aria-label="Sampai tanggal" />
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span data-testid="mutasi-total-count"><b className="num text-foreground">{data?.total ?? 0}</b> mutasi</span>
            <span>Masuk <b className="num text-green-700 dark:text-green-400" data-testid="mutasi-sum-cr">{rupiah(data?.sum_cr ?? 0)}</b></span>
            <span>Keluar <b className="num text-red-700 dark:text-red-400" data-testid="mutasi-sum-db">{rupiah(data?.sum_db ?? 0)}</b></span>
            <span className="hidden md:inline">Pintasan: <kbd className="rounded border px-1">Ctrl U</kbd> upload · <kbd className="rounded border px-1">/</kbd> cari donatur</span>
          </div>
        </div>
        <ReconciliationCard />
      </div>

      {selected.size > 0 && canWrite && (
        <div className="sticky top-20 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-card/95 p-2 shadow-lg backdrop-blur animate-rise" data-testid="bulk-toolbar">
          <span className="px-2 text-sm"><b>{selected.size}</b> dipilih</span>
          <Button size="sm" onClick={() => bulk.mutate("ok")} data-testid="bulk-ok-button"><Check /> Tandai Sudah OK</Button>
          <Button size="sm" variant="outline" onClick={() => bulk.mutate("perlu")} data-testid="bulk-perlu-button">Perlu cek</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Batal</Button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1150px] text-sm" data-testid="mutasi-table">
            <thead className="sticky top-0 bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2.5"><Checkbox checked={allSelected} onCheckedChange={(c) => setSelected(c ? new Set(items.map((m) => m.id)) : new Set())} data-testid="select-all-checkbox" /></th>
                <th className="px-2 py-2.5">Tanggal</th>
                <th className="px-2 py-2.5">Keterangan / pengirim</th>
                <th className="px-2 py-2.5 text-right">Nominal</th>
                <th className="px-2 py-2.5">Voucher</th>
                <th className="px-2 py-2.5">Donatur</th>
                <th className="px-2 py-2.5">Program</th>
                <th className="px-2 py-2.5">Jenis</th>
                <th className="px-2 py-2.5">Status</th>
                <th className="px-2 py-2.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-t"><td colSpan={10} className="px-3 py-3"><div className="h-5 animate-pulse rounded bg-muted" /></td></tr>
              ))}
              {items.map((m) => {
                const split = m.allocations.length > 1;
                const a = m.allocations[0];
                return (
                  <tr key={m.id} className={cn("border-t align-middle transition-colors hover:bg-accent/60", selected.has(m.id) && "bg-amber-50 dark:bg-amber-500/5")} data-testid={`mutasi-row-${m.id}`}>
                    <td className="px-3 py-2"><Checkbox checked={selected.has(m.id)} onCheckedChange={() => toggle(m.id)} data-testid={`mutasi-select-${m.id}`} /></td>
                    <td className="num whitespace-nowrap px-2 py-2 text-xs">{tanggal(m.date)}</td>
                    <td className="max-w-72 px-2 py-2">
                      <div className="truncate text-xs text-muted-foreground" title={m.description}>{m.description}</div>
                      <div className="truncate font-medium" data-testid={`mutasi-sender-${m.id}`}>{m.sender_name || "—"}</div>
                      {(m.ai_category || (m.ai_anomaly ?? 0) >= 0.75) && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {m.ai_category && (
                            <span className="inline-flex items-center gap-1 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 dark:bg-sky-500/15 dark:text-sky-300" title={`Kategori AI · keyakinan ${Math.round((m.ai_confidence ?? 0) * 100)}%`} data-testid={`mutasi-ai-category-${m.id}`}>
                              <Bot className="size-3" />{AI_CATEGORY_LABEL[m.ai_category] ?? m.ai_category}
                            </span>
                          )}
                          {(m.ai_anomaly ?? 0) >= 0.75 && (
                            <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800 dark:bg-red-500/15 dark:text-red-300" title={`Skor kejanggalan ${Math.round((m.ai_anomaly ?? 0) * 100)}%`} data-testid={`mutasi-ai-anomaly-${m.id}`}>
                              <AlertTriangle className="size-3" />Janggal
                            </span>
                          )}
                        </div>
                      )}
                      {m.notes && <div className="truncate text-xs italic text-muted-foreground">{m.notes}</div>}
                    </td>
                    <td className={cn("num whitespace-nowrap px-2 py-2 text-right font-medium", m.direction === "CR" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400")} data-testid={`mutasi-amount-${m.id}`}>
                      {m.direction === "CR" ? "+" : "−"}{rupiah(m.amount)}
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        disabled={!canWrite}
                        onClick={() => patch.mutate({ id: m.id, body: { channel: m.channel === "bank" ? "kas" : "bank" } })}
                        className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs transition-colors hover:bg-accent disabled:cursor-default"
                        title="Klik untuk ganti kas/bank"
                        data-testid={`mutasi-channel-${m.id}`}
                      >
                        {m.channel === "bank" ? <Landmark className="size-3" /> : <Wallet className="size-3" />}{m.voucher_type}
                      </button>
                    </td>
                    <td className="px-1 py-2">
                      {split ? (
                        <button type="button" onClick={() => setSplitting(m)} className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-500/15 dark:text-violet-300" data-testid={`mutasi-split-badge-${m.id}`}>
                          <Split className="size-3" /> Split · {m.allocations.length} donatur
                        </button>
                      ) : (
                        <div className="flex items-center gap-1">
                          {a?.receipt_number && <span title={`Bukti ${a.receipt_number} sudah terbit — alokasi terkunci`} data-testid={`mutasi-receipt-lock-${m.id}`}><Lock className="size-3.5 shrink-0 text-primary" /></span>}
                          {m.suggested && <span title={m.ai_match_score != null ? `Dicocokkan AI · ${Math.round(m.ai_match_score * 100)}%` : "Dari pemetaan sebelumnya"} data-testid={`mutasi-suggested-${m.id}`}><Sparkles className="size-3.5 shrink-0 text-amber-500" aria-label="Saran otomatis" /></span>}
                          <DonorPicker value={a?.donor_id ?? null} label={a?.donor_name ?? ""} disabled={!canWrite} onChange={(d) => patch.mutate({ id: m.id, body: { donor_id: d?.id ?? "" } })} testId={`mutasi-donor-${m.id}`} />
                        </div>
                      )}
                    </td>
                    <td className="px-1 py-2">
                      {split ? (
                        <span className="px-2 text-xs text-muted-foreground">{[...new Set(m.allocations.map((x) => x.program_name || "—"))].join(", ")}</span>
                      ) : (
                        <ProgramSelect value={a?.program_id ?? null} disabled={!canWrite} onChange={(id) => patch.mutate({ id: m.id, body: { program_id: id ?? "" } })} testId={`mutasi-program-${m.id}`} />
                      )}
                    </td>
                    <td className="px-1 py-2">
                      {split ? (
                        <span className="px-2 text-xs">{[...new Set(m.allocations.map((x) => JENIS_SHORT[x.jenis]))].join(", ")}</span>
                      ) : (
                        <Select value={a?.jenis ?? "donasi"} onValueChange={(v: string) => patch.mutate({ id: m.id, body: { jenis: v as Jenis } })} disabled={!canWrite}>
                          <SelectTrigger size="sm" className="h-8 w-24 border-transparent bg-transparent shadow-none hover:border-input" data-testid={`mutasi-jenis-${m.id}`}>
                            <SelectValue>{(v) => JENIS_SHORT[v as Jenis]}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(JENIS_SHORT) as Jenis[]).map((j) => <SelectItem key={j} value={j}>{JENIS_SHORT[j]}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="px-1 py-2">
                      <Select value={m.status} onValueChange={(v: string) => patch.mutate({ id: m.id, body: { status: v as MutasiStatus } })} disabled={!canWrite}>
                        <SelectTrigger size="sm" className={cn("h-7 w-28 rounded-full border-none text-xs font-medium shadow-none", STATUS_META[m.status].cls)} data-testid={`mutasi-status-${m.id}`}>
                          <SelectValue>{(v) => STATUS_META[v as MutasiStatus].label}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(STATUS_META) as MutasiStatus[]).map((s) => <SelectItem key={s} value={s} data-testid={`mutasi-status-option-${s}`}>{STATUS_META[s].label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      {m.suggested && canWrite && (
                        <Button size="xs" variant="outline" className="mr-1 border-amber-400 text-amber-700 dark:text-amber-300" onClick={() => confirm.mutate(m.id)} data-testid={`mutasi-confirm-${m.id}`}>
                          <Check /> Konfirmasi
                        </Button>
                      )}
                      <Button size="icon-sm" variant="ghost" onClick={() => setAttachFor(m.id)} title="Lampiran" aria-label="Lampiran" className="relative" data-testid={`mutasi-attach-${m.id}`}>
                        <Paperclip />
                        {m.attachments.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">{m.attachments.length}</span>}
                      </Button>
                      {canWrite && (
                        <Button size="icon-sm" variant="ghost" onClick={() => setSplitting(m)} title="Split" data-testid={`mutasi-split-${m.id}`} aria-label="Split"><Split /></Button>
                      )}
                      {canDelete && (
                        <Button size="icon-sm" variant="ghost" onClick={() => setDeleting(m)} title="Hapus" data-testid={`mutasi-delete-${m.id}`} aria-label="Hapus"><Trash2 /></Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!list.isLoading && items.length === 0 && (
          <div className="p-6"><EmptyState testId="mutasi-empty">Tidak ada mutasi untuk filter ini. {canWrite && <button className="text-primary underline" onClick={() => setUploadOpen(true)}>Upload mutasi</button>}</EmptyState></div>
        )}
        {data && data.total > PAGE && (
          <div className="flex items-center justify-between border-t px-4 py-2 text-sm">
            <span className="text-muted-foreground">Hal. {page + 1} dari {Math.ceil(data.total / PAGE)}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)} data-testid="page-prev">Sebelumnya</Button>
              <Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage((p) => p + 1)} data-testid="page-next">Berikutnya</Button>
            </div>
          </div>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        <Sparkles className="mr-1 inline size-3 text-amber-500" />Saran otomatis berasal dari pemetaan rekening pengirim sebelumnya, atau dicocokkan AI (keyakinan ≥80%). Label biru = kategori AI; merah = AI menilai janggal dan status diubah ke Perlu cek. Klik Konfirmasi atau ubah langsung. Rekening pengirim tiap donatur bisa dilihat di <Link to="/donatur" className="text-primary hover:underline">Donatur</Link>.
      </p>

      <SplitDialog mutasi={splitting} onClose={() => setSplitting(null)} />
      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <ImportsDialog open={importsOpen} onOpenChange={setImportsOpen} />
      <NotaReaderDialog open={notaOpen} onOpenChange={setNotaOpen} />
      {attachMutasi && (
        <AttachmentsDialog
          open
          onOpenChange={(o) => !o && setAttachFor(null)}
          title="Lampiran mutasi"
          subtitle={`${tanggal(attachMutasi.date)} · ${attachMutasi.sender_name || attachMutasi.description} · ${rupiah(attachMutasi.amount)}. Jenis dokumen dikenali otomatis oleh AI.`}
          items={attachMutasi.attachments}
          basePath={`/mutasi/${attachMutasi.id}/attachments`}
          canWrite={canWrite}
          invalidate={[["mutasi"]]}
        />
      )}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent data-testid="delete-mutasi-dialog">
          <DialogHeader>
            <DialogTitle>Hapus mutasi ini?</DialogTitle>
            <DialogDescription>{deleting && `${tanggal(deleting.date)} · ${deleting.description} · ${rupiah(deleting.amount)}`}. Tindakan ini tercatat di audit log.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Batal</Button>
            <Button variant="destructive" onClick={() => deleting && del.mutate(deleting.id)} data-testid="confirm-delete-mutasi">Hapus</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
