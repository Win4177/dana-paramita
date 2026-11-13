import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Link2, Loader2, Save, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiGet, apiPost, apiUpload } from "@/lib/api";
import { errMsg, num, parseRupiah, rupiah, tanggal } from "@/lib/format";
import type { KasIn, LinkFileIn, Mutasi, NotaRead } from "@/lib/types";

/** Photograph a receipt → AI fills date/amount/description → save as new kas transaction or attach to a matching bank mutation. */
export default function NotaReaderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [read, setRead] = useState<NotaRead | null>(null);
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [vendor, setVendor] = useState("");
  const [direction, setDirection] = useState<"CR" | "DB">("DB");
  const [cands, setCands] = useState<Mutasi[]>([]);

  useEffect(() => {
    if (open) return;
    setPreview(null); setRead(null); setDate(""); setAmount(""); setDesc(""); setVendor(""); setDirection("DB"); setCands([]);
  }, [open]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const done = () => { void qc.invalidateQueries({ queryKey: ["mutasi"] }); void qc.invalidateQueries({ queryKey: ["dashboard"] }); void qc.invalidateQueries({ queryKey: ["reconciliation"] }); onOpenChange(false); };
  const ocr = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append("file", f); return apiUpload<NotaRead>("/nota/read", fd); },
    onSuccess: (r) => {
      setRead(r); setDate(r.date); setAmount(r.amount ? num(r.amount) : ""); setDesc(r.description); setVendor(r.vendor); setDirection(r.direction); setCands(r.candidates);
      toast.success(`Dibaca oleh ${r.model}. Periksa lalu simpan.`);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const research = useMutation({
    mutationFn: () => apiGet<Mutasi[]>(`/nota/candidates?amount=${parseRupiah(amount)}&date=${date}`),
    onSuccess: setCands,
    onError: (e) => toast.error(errMsg(e)),
  });
  const saveKas = useMutation({
    mutationFn: () => apiPost<Mutasi>("/mutasi/kas", { date, description: [desc, vendor && `(${vendor})`].filter(Boolean).join(" "), amount: parseRupiah(amount), direction, sender_name: vendor, notes: "", file_id: read?.file_id ?? null } satisfies KasIn),
    onSuccess: (m) => { toast.success(`Transaksi kas ${m.voucher_type} ${rupiah(m.amount)} tersimpan dengan foto nota`); done(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const link = useMutation({
    mutationFn: (mid: string) => apiPost<Mutasi>(`/mutasi/${mid}/attachments/link`, { file_id: read!.file_id } satisfies LinkFileIn),
    onSuccess: (m) => { toast.success(`Foto dilampirkan ke mutasi ${tanggal(m.date)} ${rupiah(m.amount)}`); done(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && parseRupiah(amount) > 0 && desc.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl" data-testid="nota-reader-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Camera className="size-4" /> Baca foto nota</DialogTitle>
          <DialogDescription>Foto nota/kuitansi dibaca AI (Gemini 3 Flash; cadangan GPT-5.2 dan Claude Sonnet). Hasil selalu bisa dikoreksi sebelum disimpan.</DialogDescription>
        </DialogHeader>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; setPreview(URL.createObjectURL(f)); setRead(null); ocr.mutate(f); }} data-testid="nota-file-input" />
        <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
          <button type="button" onClick={() => input.current?.click()} className="grid aspect-[3/4] place-items-center overflow-hidden rounded-xl border-2 border-dashed bg-muted/40 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary" data-testid="nota-photo-button">
            {preview ? <img src={preview} alt="Foto nota" className="size-full object-cover" /> : <span className="flex flex-col items-center gap-2 p-3 text-center"><Camera className="size-7" />Ambil / pilih foto</span>}
          </button>
          <div className="space-y-3">
            {ocr.isPending && <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary" data-testid="nota-reading"><Loader2 className="size-4 animate-spin" /> AI sedang membaca nota…</div>}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="nota-date">Tanggal</Label><Input id="nota-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="nota-date-input" /></div>
              <div className="space-y-1.5"><Label htmlFor="nota-amount">Nominal (Rp)</Label><Input id="nota-amount" className="num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="nota-amount-input" /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="nota-desc">Keterangan</Label><Input id="nota-desc" value={desc} onChange={(e) => setDesc(e.target.value)} data-testid="nota-description-input" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="nota-vendor">Toko / pihak</Label><Input id="nota-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} data-testid="nota-vendor-input" /></div>
              <div className="space-y-1.5">
                <Label>Arah</Label>
                <Select value={direction} onValueChange={(v: string) => setDirection(v as "CR" | "DB")}>
                  <SelectTrigger className="w-full" data-testid="nota-direction-select"><SelectValue>{(v) => (v === "DB" ? "Keluar (BKK)" : "Masuk (BKM)")}</SelectValue></SelectTrigger>
                  <SelectContent><SelectItem value="DB">Keluar (BKK)</SelectItem><SelectItem value="CR">Masuk (BKM)</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
        {read && (
          <div className="rounded-xl border p-3" data-testid="nota-candidates">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Mutasi bank yang cocok (nominal sama, ±10 hari)</div>
              <Button size="xs" variant="ghost" onClick={() => research.mutate()} disabled={research.isPending || !parseRupiah(amount)} data-testid="nota-research-button">Cari ulang</Button>
            </div>
            {cands.length === 0 ? <p className="text-xs text-muted-foreground" data-testid="nota-no-candidates">Tidak ada mutasi yang cocok — simpan sebagai transaksi kas baru.</p> : (
              <ul className="space-y-1.5">
                {cands.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs" data-testid={`nota-candidate-${m.id}`}>
                    <span className="num">{tanggal(m.date)}</span>
                    <span className="min-w-0 flex-1 truncate">{m.sender_name || m.description}</span>
                    <span className="num font-medium">{m.direction === "CR" ? "+" : "−"}{rupiah(m.amount)}</span>
                    <Button size="xs" variant="outline" onClick={() => link.mutate(m.id)} disabled={link.isPending} data-testid={`nota-link-${m.id}`}><Link2 /> Lampirkan</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Tutup</Button>
          <Button onClick={() => saveKas.mutate()} disabled={!valid || saveKas.isPending || ocr.isPending} data-testid="nota-save-kas-button">
            {saveKas.isPending ? <Save /> : <Wallet />} Simpan sebagai transaksi kas {direction === "DB" ? "BKK" : "BKM"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
