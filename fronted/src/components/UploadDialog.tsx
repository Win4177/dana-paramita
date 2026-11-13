import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileSpreadsheet, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiGet, apiUpload } from "@/lib/api";
import { errMsg } from "@/lib/format";
import type { ImportResult, ParserTemplate } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function UploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const templates = useQuery({ queryKey: ["parser-templates"], queryFn: () => apiGet<ParserTemplate[]>("/parser-templates"), enabled: open });
  const names = Object.fromEntries((templates.data ?? []).map((t) => [t.id, t.name]));
  const defaultId = templates.data?.find((t) => t.is_default)?.id ?? "";

  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", file!);
      fd.append("template_id", templateId || defaultId);
      return apiUpload<ImportResult>("/mutasi/import", fd);
    },
    onSuccess: (r) => {
      setResult(r);
      toast.success(`Impor selesai: ${r.inserted} baru, ${r.updated} diperbarui, ${r.duplicates} duplikat dilewati`);
      void qc.invalidateQueries({ queryKey: ["mutasi"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      void qc.invalidateQueries({ queryKey: ["reconciliation"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setFile(null);
      setResult(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg" data-testid="upload-dialog">
        <DialogHeader>
          <DialogTitle>Upload mutasi rekening</DialogTitle>
          <DialogDescription>
            File .xlsx / .csv dari KlikBCA, atau file hasil <b>Export</b> aplikasi ini (kategori, donatur & status akan dipulihkan tanpa duplikat).
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); setFile(e.dataTransfer.files[0] ?? null); }}
              className={cn("flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors", drag ? "border-primary bg-primary/5" : "hover:border-primary/60 hover:bg-accent")}
              data-testid="upload-dropzone"
            >
              {file ? <FileSpreadsheet className="size-8 text-primary" /> : <UploadCloud className="size-8 text-muted-foreground" />}
              <span className="text-sm font-medium">{file ? file.name : "Klik atau seret file ke sini"}</span>
              <span className="text-xs text-muted-foreground">Format ribuan 1.000.000,00 maupun 1,000,000.00 didukung</span>
            </button>
            <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.csv,.txt" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="upload-file-input" />
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Template parser bank</div>
              <Select value={templateId || defaultId} onValueChange={(v: string) => setTemplateId(v)}>
                <SelectTrigger className="w-full" data-testid="upload-template-select">
                  <SelectValue>{(v) => names[v as string] ?? "Pilih template"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {templates.data?.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <a href="/contoh/mutasi_bca_contoh.csv" download className="text-xs text-primary underline-offset-2 hover:underline" data-testid="upload-sample-link">
              Unduh contoh file mutasi BCA (data demo)
            </a>
          </>
        ) : (
          <div className="space-y-3" data-testid="upload-result">
            <div className="flex items-center gap-2 text-sm font-medium text-success"><CheckCircle2 className="size-5" /> Impor {result.mode === "roundtrip" ? "round-trip (hasil export)" : "mutasi bank"} selesai</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                ["Baris terbaca", result.total_rows, "total"], ["Baru ditambahkan", result.inserted, "inserted"],
                ["Duplikat dilewati", result.duplicates, "duplicates"], ["Diperbarui", result.updated, "updated"],
                ["Saran otomatis", result.suggested, "suggested"], ["Error", result.errors.length, "errors"],
              ].map(([l, v, k]) => (
                <div key={k as string} className="rounded-lg border bg-muted/40 px-3 py-2">
                  <div className="text-xs text-muted-foreground">{l}</div>
                  <div className="num text-lg" data-testid={`upload-result-${k}`}>{v}</div>
                </div>
              ))}
            </div>
            {result.errors.length > 0 && (
              <ul className="max-h-32 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {result.errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          {!result ? (
            <Button onClick={() => upload.mutate()} disabled={!file || upload.isPending} data-testid="upload-submit">
              {upload.isPending ? "Memproses…" : "Proses file"}
            </Button>
          ) : (
            <Button onClick={() => close(false)} data-testid="upload-done">Selesai</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
