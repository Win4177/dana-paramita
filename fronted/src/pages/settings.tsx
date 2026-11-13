import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ImageIcon, Save, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/common";
import { apiDownload, apiGet, apiPut, apiUpload } from "@/lib/api";
import { can, useMe } from "@/lib/auth";
import { errMsg, num, parseRupiah } from "@/lib/format";
import type { ParserTemplate, Settings as S } from "@/lib/types";

type TextKey = "name" | "name_mandarin" | "phone" | "email" | "register_no" | "bank_name" | "bank_account" | "bank_account_holder" | "receipt_number_format" | "receipt_code" | "signer_name" | "signer_title";
type MoneyKey = "opening_bank_balance" | "opening_cash_balance" | "approval_threshold";

function BrandingUpload({ kind, label, url, editable }: { kind: "logo" | "signature"; label: string; url: string; editable: boolean }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const up = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append("file", file); return apiUpload<S>(`/settings/branding/${kind}`, fd); },
    onSuccess: () => { toast.success(`${label} tersimpan`); void qc.invalidateQueries({ queryKey: ["settings"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <div className="flex items-center gap-4 rounded-lg border p-3" data-testid={`branding-${kind}`}>
      <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-md bg-muted">
        {url ? <img src={url} alt={label} className="max-h-full max-w-full object-contain" data-testid={`branding-${kind}-preview`} /> : <ImageIcon className="size-6 text-muted-foreground" />}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="mb-2 text-xs text-muted-foreground">{url ? "Sudah diunggah" : "Belum ada"}</div>
        {editable && (
          <>
            <input ref={input} type="file" accept=".png,.jpg,.jpeg,.webp" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) up.mutate(file); }} data-testid={`branding-${kind}-input`} />
            <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()} disabled={up.isPending} data-testid={`branding-${kind}-upload-button`}><Upload /> {up.isPending ? "Mengunggah…" : url ? "Ganti" : "Unggah"}</Button>
          </>
        )}
      </div>
    </div>
  );
}

export default function Settings() {
  const qc = useQueryClient();
  const me = useMe();
  const editable = can(me.data, "pengaturan", "write");
  const q = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<S>("/settings") });
  const tpl = useQuery({ queryKey: ["parser-templates"], queryFn: () => apiGet<ParserTemplate[]>("/parser-templates") });
  const [f, setF] = useState<S | null>(null);
  const [money, setMoney] = useState<Record<MoneyKey, string>>({ opening_bank_balance: "", opening_cash_balance: "", approval_threshold: "" });
  useEffect(() => {
    if (!q.data) return;
    setF(q.data);
    setMoney({ opening_bank_balance: num(q.data.opening_bank_balance), opening_cash_balance: num(q.data.opening_cash_balance), approval_threshold: num(q.data.approval_threshold) });
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => apiPut<S>("/settings", {
      ...f!,
      opening_bank_balance: parseRupiah(money.opening_bank_balance),
      opening_cash_balance: parseRupiah(money.opening_cash_balance),
      approval_threshold: parseRupiah(money.approval_threshold),
    }),
    onSuccess: () => { toast.success("Pengaturan tersimpan"); void qc.invalidateQueries({ queryKey: ["settings"] }); void qc.invalidateQueries({ queryKey: ["dashboard"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const backup = useMutation({ mutationFn: () => apiDownload("/settings/backup", "backup_paramita.json"), onError: (e) => toast.error(errMsg(e)) });

  if (!f) return <div className="h-60 animate-pulse rounded-xl bg-muted" />;
  const text = (k: TextKey, label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`set-${k}`}>{label}</Label>
      <Input id={`set-${k}`} value={f[k]} disabled={!editable} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`settings-${k}`} />
    </div>
  );
  const moneyField = (k: MoneyKey, label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`set-${k}`}>{label}</Label>
      <Input id={`set-${k}`} className="num" inputMode="decimal" disabled={!editable} value={money[k]} onChange={(e) => setMoney({ ...money, [k]: e.target.value })} data-testid={`settings-${k}`} />
    </div>
  );
  const section = (title: string, children: React.ReactNode, testId: string) => (
    <section className="rounded-xl border bg-card p-5" data-testid={testId}>
      <h2 className="mb-4 font-semibold">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <PageHeader
        eyebrow="Konfigurasi"
        title="Pengaturan Yayasan"
        subtitle="Identitas kop surat, rekening, saldo awal, penomoran bukti pembayaran, dan batas persetujuan."
        actions={
          <>
            {can(me.data, "pengaturan", "delete") && <Button type="button" variant="outline" onClick={() => backup.mutate()} disabled={backup.isPending} data-testid="settings-backup-button"><Download /> Backup data</Button>}
            {editable && <Button type="submit" disabled={save.isPending} data-testid="settings-save-button"><Save /> Simpan</Button>}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-2">
        {section("Identitas yayasan", <>
          {text("name", "Nama yayasan")}
          {text("name_mandarin", "Nama Mandarin")}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="set-address">Alamat</Label>
            <Textarea id="set-address" value={f.address} disabled={!editable} onChange={(e) => setF({ ...f, address: e.target.value })} data-testid="settings-address" />
          </div>
          {text("phone", "Telepon")}
          {text("email", "Email")}
          {text("register_no", "No. registrasi")}
        </>, "settings-identity")}
        {section("Rekening & saldo awal", <>
          {text("bank_name", "Bank")}
          {text("bank_account", "No. rekening")}
          {text("bank_account_holder", "Atas nama")}
          <div className="space-y-1.5">
            <Label htmlFor="set-fy">Tahun buku</Label>
            <Input id="set-fy" type="number" className="num" disabled={!editable} value={f.fiscal_year} onChange={(e) => setF({ ...f, fiscal_year: Number(e.target.value) })} data-testid="settings-fiscal_year" />
          </div>
          {moneyField("opening_bank_balance", "Saldo awal bank (Rp)")}
          {moneyField("opening_cash_balance", "Saldo awal kas (Rp)")}
        </>, "settings-bank")}
        {section("Bukti pembayaran & persetujuan", <>
          {text("receipt_code", "Kode bukti")}
          {text("receipt_number_format", "Format nomor")}
          <div className="space-y-1.5">
            <Label htmlFor="set-digital">Nomor awal digital</Label>
            <Input id="set-digital" type="number" className="num" disabled={!editable} value={f.receipt_digital_from} onChange={(e) => setF({ ...f, receipt_digital_from: Number(e.target.value) })} data-testid="settings-receipt_digital_from" />
          </div>
          {moneyField("approval_threshold", "Batas wajib persetujuan pengeluaran (Rp)")}
          <label className="flex items-center gap-3 text-sm sm:col-span-2">
            <Switch checked={f.receipt_merge_same_day} disabled={!editable} onCheckedChange={(c) => setF({ ...f, receipt_merge_same_day: c })} data-testid="settings-receipt_merge_same_day" />
            Gabungkan donasi donatur yang sama di hari yang sama dalam satu bukti
          </label>
        </>, "settings-receipt")}
        {section("Penandatangan & standar akuntansi", <>
          {text("signer_name", "Nama penandatangan")}
          {text("signer_title", "Jabatan")}
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Standar akuntansi</Label>
            <Select value={f.accounting_standard} disabled={!editable} onValueChange={(v: string) => setF({ ...f, accounting_standard: v as S["accounting_standard"] })}>
              <SelectTrigger className="w-full" data-testid="settings-accounting_standard"><SelectValue>{(v) => (v === "ISAK35" ? "ISAK 35 (entitas nirlaba)" : "SAK EMKM")}</SelectValue></SelectTrigger>
              <SelectContent><SelectItem value="ISAK35">ISAK 35 (entitas nirlaba)</SelectItem><SelectItem value="SAK_EMKM">SAK EMKM</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="set-quote">Kutipan footer bukti</Label>
            <Textarea id="set-quote" value={f.footer_quote} disabled={!editable} onChange={(e) => setF({ ...f, footer_quote: e.target.value })} data-testid="settings-footer_quote" />
          </div>
        </>, "settings-signer")}
      </div>
      <section className="mt-4 rounded-xl border bg-card p-5" data-testid="settings-branding">
        <h2 className="mb-1 font-semibold">Logo & tanda tangan</h2>
        <p className="mb-4 text-xs text-muted-foreground">Dipakai di kop bukti pembayaran dan voucher. PNG/JPG/WEBP, maks 2 MB. Latar transparan disarankan untuk tanda tangan.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <BrandingUpload kind="logo" label="Logo yayasan" url={f.logo_data_url} editable={editable} />
          <BrandingUpload kind="signature" label="Tanda tangan penandatangan" url={f.signature_data_url} editable={editable} />
        </div>
      </section>
      <section className="mt-4 rounded-xl border bg-card p-5" data-testid="settings-parser-templates">
        <h2 className="mb-1 font-semibold">Template parser mutasi bank</h2>
        <p className="mb-3 text-xs text-muted-foreground">Pemetaan kolom file mutasi. Template default dipakai otomatis saat unggah.</p>
        <ul className="space-y-2 text-sm">
          {tpl.data?.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2" data-testid={`parser-template-${t.id}`}>
              <span className="font-medium">{t.name} <span className="text-xs text-muted-foreground">· {t.bank}</span>{t.is_default && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">default</span>}</span>
              <span className="text-xs text-muted-foreground">Tanggal: {t.col_date} · Keterangan: {t.col_description} · Jumlah: {t.col_amount || `${t.col_debit}/${t.col_credit}`} · Saldo: {t.col_balance || "—"}</span>
            </li>
          ))}
        </ul>
      </section>
    </form>
  );
}
