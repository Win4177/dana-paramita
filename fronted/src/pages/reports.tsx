import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/common";
import { apiDownload, apiGet } from "@/lib/api";
import { errMsg, num } from "@/lib/format";
import type { Report, ReportCell } from "@/lib/types";
import { cn } from "@/lib/utils";

const REPORTS: { key: string; label: string; hint: string }[] = [
  { key: "isak35", label: "Laporan Keuangan ISAK 35", hint: "Posisi keuangan, penghasilan komprehensif, perubahan aset neto, arus kas" },
  { key: "kasbank", label: "Buku Kas & Bank", hint: "Saldo awal–akhir per transaksi, nomor voucher" },
  { key: "program", label: "Laporan per Program", hint: "Target, terkumpul, tersalurkan, sisa" },
  { key: "donatur", label: "Rekap Donatur & Bukti", hint: "Total per donatur dan nomor bukti pembayaran" },
  { key: "cicilan", label: "Rekap Cicilan FU / FU HUI", hint: "Setoran, tunggakan, konfirmasi per anggota" },
];
const THIS_YEAR = new Date().getFullYear();

function Cell({ v, first }: { v: ReportCell; first: boolean }) {
  if (typeof v === "number") return <span className={cn("num", v < 0 && "text-red-700 dark:text-red-400")}>{v < 0 ? `(${num(-v)})` : num(v)}</span>;
  return <span className={first ? "whitespace-pre" : ""}>{v ?? ""}</span>;
}

export default function Reports() {
  const [key, setKey] = useState("isak35");
  const [year, setYear] = useState(THIS_YEAR);
  const [month, setMonth] = useState("");
  const qs = `year=${year}${key === "kasbank" && month ? `&month=${month}` : ""}`;
  const q = useQuery({ queryKey: ["report", key, qs], queryFn: () => apiGet<Report>(`/reports/${key}?${qs}`) });
  const r = q.isError ? undefined : q.data;
  const download = (format: "xlsx" | "pdf") => apiDownload(`/reports/${key}/export?format=${format}&${qs}`, `laporan_${key}.${format}`).catch((e: unknown) => toast.error(errMsg(e)));
  return (
    <div>
      <PageHeader eyebrow="Laporan" title="Laporan Keuangan" subtitle="Semua laporan dihitung langsung dari mutasi, bukti, voucher, dan cicilan. Unduh Excel atau PDF."
        actions={<><Button variant="outline" onClick={() => void download("xlsx")} data-testid="report-xlsx-button"><FileSpreadsheet /> Excel</Button><Button onClick={() => void download("pdf")} data-testid="report-pdf-button"><FileDown /> PDF</Button></>} />
      <div className="mb-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-5" data-testid="report-picker">
        {REPORTS.map((x) => (
          <button key={x.key} type="button" onClick={() => setKey(x.key)} data-testid={`report-tab-${x.key}`}
            className={cn("rounded-xl border bg-card p-3 text-left transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:shadow-sm", key === x.key && "border-primary shadow-[0_6px_20px_-10px_rgba(234,88,12,0.6)]")}>
            <div className="text-sm font-semibold">{x.label}</div>
            <div className="text-xs text-muted-foreground">{x.hint}</div>
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={String(year)} onValueChange={(v: string) => setYear(Number(v))}>
          <SelectTrigger className="h-9 w-28 bg-card" data-testid="report-year-select"><SelectValue /></SelectTrigger>
          <SelectContent>{[THIS_YEAR, THIS_YEAR - 1, THIS_YEAR - 2].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
        </Select>
        {key === "kasbank" && <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-40 bg-card" aria-label="Bulan" data-testid="report-month-input" />}
        {q.isFetching && <span className="text-xs text-muted-foreground">memuat…</span>}
      </div>
      <div className="space-y-5" data-testid="report-content">
        {r?.sections.map((s, si) => (
          <section key={si} className="animate-rise overflow-hidden rounded-xl border bg-card" data-testid={`report-section-${si}`}>
            <h2 className="px-5 pb-2 pt-4 font-semibold">{s.title}</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>{s.columns.map((c, i) => <th key={c} className={cn("px-4 py-2", i === 0 ? "text-left" : "text-right")}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {s.rows.map((row, ri) => {
                    const heading = row.slice(1).every((v) => v === null);
                    return (
                      <tr key={ri} className={cn("border-t", heading && "bg-muted/30 font-semibold")}>
                        {row.map((v, i) => <td key={i} className={cn("px-4 py-1.5", i === 0 || typeof v !== "number" ? "text-left" : "text-right", i > 0 && typeof v === "string" && "text-xs")}><Cell v={v} first={i === 0} /></td>)}
                      </tr>
                    );
                  })}
                  {s.total && (
                    <tr className="border-t-2 border-foreground/40 font-semibold" data-testid={`report-total-${si}`}>
                      {s.total.map((v, i) => <td key={i} className={cn("px-4 py-2", typeof v === "number" ? "text-right" : "text-left")}><Cell v={v} first={i === 0} /></td>)}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        {r?.notes.map((n) => <p key={n} className="text-xs text-muted-foreground">{n}</p>)}
      </div>
    </div>
  );
}
