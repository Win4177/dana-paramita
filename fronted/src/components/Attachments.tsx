import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiDelete, apiUpload } from "@/lib/api";
import { errMsg, waktu } from "@/lib/format";
import type { Attachment } from "@/lib/types";

export const DOC_TYPE_LABEL: Record<string, string> = {
  bukti_transfer: "Bukti transfer", nota: "Nota", kuitansi: "Kuitansi", proposal: "Proposal",
  ktp: "KTP", npwp: "NPWP", kartu_keluarga: "Kartu Keluarga", surat_pernyataan: "Surat pernyataan", lainnya: "Lainnya",
};
const ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.pdf";

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** List + upload + delete for files attached to a record (mutasi or donor). basePath e.g. /mutasi/{id}/attachments */
export function AttachmentList({ items, basePath, canWrite, invalidate, testPrefix }: { items: Attachment[]; basePath: string; canWrite: boolean; invalidate: string[][]; testPrefix: string }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const refresh = () => invalidate.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f);
        await apiUpload<Attachment>(basePath, fd);
      }
    },
    onSuccess: () => { toast.success("File tersimpan"); refresh(); },
    onError: (e) => { toast.error(errMsg(e)); refresh(); },
  });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`${basePath}/${id}`),
    onSuccess: () => { toast.success("File dihapus (tercatat di audit log)"); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <div data-testid={`${testPrefix}-attachments`}>
      {canWrite && (
        <>
          <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; if (fs.length) upload.mutate(fs); }} data-testid={`${testPrefix}-file-input`} />
          <Button variant="outline" size="sm" className="mb-3" onClick={() => input.current?.click()} disabled={upload.isPending} data-testid={`${testPrefix}-upload-button`}>
            <Upload /> {upload.isPending ? "Mengunggah & mengenali jenis…" : "Unggah file (JPG/PNG/PDF, maks 10 MB)"}
          </Button>
        </>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid={`${testPrefix}-attachments-empty`}>Belum ada file.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm" data-testid={`${testPrefix}-attachment-${a.id}`}>
              {a.content_type.startsWith("image/") && a.content_type !== "image/heic"
                ? <img src={`/api/files/${a.id}`} alt={a.filename} className="size-10 shrink-0 rounded object-cover" />
                : <FileText className="size-8 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{a.filename}</div>
                <div className="text-xs text-muted-foreground">
                  {a.doc_type && <span className="mr-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary" title={`Dikenali AI · keyakinan ${Math.round((a.doc_type_confidence ?? 0) * 100)}%`} data-testid={`${testPrefix}-attachment-type-${a.id}`}>{DOC_TYPE_LABEL[a.doc_type] ?? a.doc_type}</span>}
                  {kb(a.size)} · {a.uploaded_by} · {a.uploaded_at ? waktu(a.uploaded_at) : ""}
                </div>
              </div>
              <a href={`/api/files/${a.id}`} target="_blank" rel="noreferrer" aria-label="Buka" className="grid size-8 place-items-center rounded-md transition-colors hover:bg-accent" data-testid={`${testPrefix}-attachment-open-${a.id}`}><ExternalLink className="size-4" /></a>
              {canWrite && <Button size="icon-sm" variant="ghost" aria-label="Hapus" onClick={() => del.mutate(a.id)} data-testid={`${testPrefix}-attachment-delete-${a.id}`}><Trash2 /></Button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AttachmentsDialog({ title, subtitle, items, basePath, canWrite, invalidate, open, onOpenChange }: { title: string; subtitle?: string; items: Attachment[]; basePath: string; canWrite: boolean; invalidate: string[][]; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="attachments-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Paperclip className="size-4" /> {title}</DialogTitle>
          {subtitle && <DialogDescription>{subtitle}</DialogDescription>}
        </DialogHeader>
        <AttachmentList items={items} basePath={basePath} canWrite={canWrite} invalidate={invalidate} testPrefix="mutasi" />
      </DialogContent>
    </Dialog>
  );
}
