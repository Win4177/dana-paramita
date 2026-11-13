import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Scale, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DonorPicker, ProgramSelect } from "@/components/Pickers";
import { apiPost } from "@/lib/api";
import { errMsg, num, parseRupiah, rupiah, tanggal } from "@/lib/format";
import type { Allocation, Jenis, Mutasi } from "@/lib/types";
import { cn } from "@/lib/utils";

type Row = Allocation & { key: number; amountText: string };
let seq = 0;
const blank = (amount = 0): Row => ({ key: ++seq, donor_id: null, donor_name: "", program_id: null, program_name: "", jenis: "donasi", amount, notes: "", amountText: amount ? num(amount) : "" });
const JENIS_LABEL: Record<Jenis, string> = { donasi: "Donasi program", cicilan: "Cicilan", lainnya: "Lainnya" };

export default function SplitDialog({ mutasi, onClose }: { mutasi: Mutasi | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!mutasi) return;
    setRows(mutasi.allocations.length ? mutasi.allocations.map((a) => ({ ...a, key: ++seq, amountText: num(a.amount) })) : [blank(mutasi.amount), blank()]);
  }, [mutasi]);

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const diff = Math.round(((mutasi?.amount ?? 0) - total) * 100) / 100;
  const pct = mutasi ? Math.min(100, (total / mutasi.amount) * 100) : 0;

  const save = useMutation({
    mutationFn: () => apiPost<Mutasi>(`/mutasi/${mutasi!.id}/split`, { allocations: rows.filter((r) => r.amount > 0).map(({ key: _k, amountText: _a, ...a }) => a) }),
    onSuccess: () => {
      toast.success("Split tersimpan");
      void qc.invalidateQueries({ queryKey: ["mutasi"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const splitEven = () => {
    if (!mutasi || rows.length === 0) return;
    const each = Math.floor(mutasi.amount / rows.length);
    setRows((rs) => rs.map((r, i) => {
      const amt = i === rs.length - 1 ? mutasi.amount - each * (rs.length - 1) : each;
      return { ...r, amount: amt, amountText: num(amt) };
    }));
  };

  return (
    <Dialog open={!!mutasi} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-4xl" data-testid="split-dialog">
        <DialogHeader>
          <DialogTitle>Split mutasi ke beberapa donatur / program</DialogTitle>
          <DialogDescription>
            {mutasi && <>{tanggal(mutasi.date)} · {mutasi.sender_name || mutasi.description} · <span className="num font-medium text-foreground">{rupiah(mutasi.amount)}</span></>}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/40 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>Teralokasi <b className="num">{rupiah(total)}</b> dari <span className="num">{rupiah(mutasi?.amount)}</span></span>
            <span
              className={cn("num rounded-full px-2.5 py-0.5 text-xs font-semibold", diff === 0 ? "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300" : "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300")}
              data-testid="split-remaining"
            >
              {diff === 0 ? "Seimbang ✓" : diff > 0 ? `Sisa belum dialokasikan: ${rupiah(diff)}` : `Kelebihan: ${rupiah(-diff)}`}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-background">
            <div className={cn("h-full transition-[width] duration-300", diff < 0 ? "bg-red-500" : "bg-gradient-to-r from-amber-500 to-orange-600")} style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.key} className="grid grid-cols-12 items-center gap-2 rounded-lg border bg-card p-2" data-testid={`split-row-${i}`}>
              <div className="col-span-12 md:col-span-4">
                <DonorPicker value={r.donor_id} label={r.donor_name} onChange={(d) => update(r.key, { donor_id: d?.id ?? null, donor_name: d ? `${d.name_latin} ${d.name_mandarin}`.trim() : "" })} testId={`split-row-${i}-donor`} />
              </div>
              <div className="col-span-6 md:col-span-3">
                <ProgramSelect value={r.program_id} onChange={(id) => update(r.key, { program_id: id })} testId={`split-row-${i}-program`} className="border-input" />
              </div>
              <div className="col-span-6 md:col-span-2">
                <Select value={r.jenis} onValueChange={(v: string) => update(r.key, { jenis: v as Jenis })}>
                  <SelectTrigger size="sm" className="h-8 w-full" data-testid={`split-row-${i}-jenis`}>
                    <SelectValue>{(v) => JENIS_LABEL[v as Jenis]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(JENIS_LABEL) as Jenis[]).map((j) => <SelectItem key={j} value={j}>{JENIS_LABEL[j]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-10 md:col-span-2">
                <Input
                  inputMode="decimal"
                  value={r.amountText}
                  onChange={(e) => update(r.key, { amountText: e.target.value, amount: parseRupiah(e.target.value) })}
                  onBlur={() => update(r.key, { amountText: r.amount ? num(r.amount) : "" })}
                  className="num h-8 text-right"
                  placeholder="0"
                  data-testid={`split-row-${i}-amount`}
                />
              </div>
              <div className="col-span-2 md:col-span-1 flex justify-end">
                <Button variant="ghost" size="icon-sm" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} disabled={rows.length === 1} data-testid={`split-row-${i}-remove`} aria-label="Hapus baris">
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, blank(diff > 0 ? diff : 0)])} data-testid="split-add-row"><Plus /> Tambah baris</Button>
          <Button variant="outline" size="sm" onClick={splitEven} data-testid="split-even"><Scale /> Bagi rata</Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} data-testid="split-cancel">Batal</Button>
          <Button onClick={() => save.mutate()} disabled={diff !== 0 || save.isPending} data-testid="split-save">
            {save.isPending ? "Menyimpan…" : "Simpan split"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
