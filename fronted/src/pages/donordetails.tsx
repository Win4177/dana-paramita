import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Stat, StatusPill } from "@/components/common";
import { DonorFormDialog } from "@/pages/Donors";
import { AttachmentList } from "@/components/Attachments";
import { apiGet } from "@/lib/api";
import { can, useMe } from "@/lib/auth";
import { rupiah, tanggal } from "@/lib/format";
import type { DonorProfile, MutasiStatus } from "@/lib/types";

export default function DonorDetail() {
  const { id } = useParams();
  const me = useMe();
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ["donor", id], queryFn: () => apiGet<DonorProfile>(`/donors/${id}`) });
  const p = q.isError ? undefined : q.data;
  const d = p?.donor;

  return (
    <div>
      <Link to="/donatur" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="back-to-donors"><ArrowLeft className="size-4" /> Donatur</Link>
      <PageHeader
        eyebrow="Profil donatur"
        title={<span data-testid="donor-profile-name">{d ? <>{d.name_latin} <span className="font-normal text-muted-foreground">{d.name_mandarin}</span></> : q.isError ? "Donatur tidak ditemukan" : "…"}</span>}
        subtitle={d ? [d.name_pinyin && `pinyin: ${d.name_pinyin}`, d.alias && `alias: ${d.alias}`, d.phone, d.pic && `PIC: ${d.pic}`].filter(Boolean).join(" · ") : undefined}
        actions={d && can(me.data, "donatur", "write") && <Button variant="outline" onClick={() => setEditing(true)} data-testid="edit-donor-button"><Pencil /> Ubah</Button>}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat accent label="Total donasi" value={rupiah(d?.total_donasi ?? 0)} testId="donor-total" />
        <Stat label="Jumlah kali donasi" value={d?.donation_count ?? 0} testId="donor-count" />
        <Stat label="NPWP" value={<span className="text-base">{d?.npwp || "—"}</span>} testId="donor-npwp" />
        <Stat label="Rekening pengirim" value={<span className="text-sm">{d?.bank_accounts.join(", ") || "—"}</span>} testId="donor-accounts" />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_2fr]">
        <section className="rounded-xl border bg-card p-5" data-testid="donor-per-program">
          <h2 className="mb-3 font-semibold">Per program</h2>
          {p?.per_program.length ? (
            <ul className="space-y-2">
              {p.per_program.map((x) => (
                <li key={x.program} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">{x.program}</div>
                    <div className="text-xs text-muted-foreground">{x.jenis === "cicilan" ? `Cicilan ke-${x.count}` : `${x.count}× donasi`}</div>
                  </div>
                  <div className="num">{rupiah(x.total)}</div>
                </li>
              ))}
            </ul>
          ) : <EmptyState>Belum ada riwayat.</EmptyState>}
          <p className="mt-4 text-xs text-muted-foreground">Bukti pembayaran yang terbit akan tampil di sini (fase Bukti Pembayaran).</p>
          <h2 className="mb-3 mt-6 font-semibold">Dokumen donatur</h2>
          <p className="mb-3 text-xs text-muted-foreground">KTP, NPWP, atau formulir. Jenis dokumen dikenali otomatis oleh AI. Hanya pengguna dengan akses modul Donatur yang bisa membuka.</p>
          {d && <AttachmentList items={d.documents} basePath={`/donors/${d.id}/documents`} canWrite={can(me.data, "donatur", "write")} invalidate={[["donor", id ?? ""]]} testPrefix="donor" />}
        </section>
        <section className="overflow-hidden rounded-xl border bg-card" data-testid="donor-history">
          <h2 className="px-5 pb-2 pt-5 font-semibold">Riwayat donasi</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-5 py-2">Tanggal</th><th className="px-3 py-2">Program</th><th className="px-3 py-2">Via rekening</th><th className="px-3 py-2">Status</th><th className="px-5 py-2 text-right">Nominal</th></tr>
              </thead>
              <tbody>
                {p?.history.map((h, i) => (
                  <tr key={`${h.mutasi_id}-${i}`} className="border-t" data-testid={`donor-history-row-${i}`}>
                    <td className="num px-5 py-2 text-xs">{tanggal(h.date)}</td>
                    <td className="px-3 py-2">{h.program_name || "—"} <span className="text-xs text-muted-foreground">· {h.jenis}</span></td>
                    <td className="px-3 py-2 text-xs">{h.sender_name}</td>
                    <td className="px-3 py-2"><StatusPill status={h.status as MutasiStatus} /></td>
                    <td className="num px-5 py-2 text-right">{rupiah(h.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {p && p.history.length === 0 && <div className="p-5"><EmptyState>Belum ada donasi tercatat.</EmptyState></div>}
        </section>
      </div>
      {d && <DonorFormDialog open={editing} onOpenChange={setEditing} donor={d} />}
    </div>
  );
}
