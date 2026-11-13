import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, PageHeader } from "@/components/common";
import { useDebounced } from "@/components/Pickers";
import { apiGet } from "@/lib/api";
import { waktu } from "@/lib/format";
import type { AuditPage } from "@/lib/types";

export default function AuditLog() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [page, setPage] = useState(0);
  const list = useQuery({ queryKey: ["audit", dq, page], queryFn: () => apiGet<AuditPage>(`/audit?q=${encodeURIComponent(dq)}&skip=${page * 50}&limit=50`), placeholderData: keepPreviousData });
  const data = list.isError ? undefined : list.data;
  return (
    <div>
      <PageHeader eyebrow="Jejak audit" title="Audit Log" subtitle="Siapa mengubah apa dan kapan — login, impor, kategorisasi, split, pengguna, dan pengaturan." />
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Cari pengguna / aksi / keterangan" className="bg-card pl-9" data-testid="audit-search-input" />
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[720px] text-sm" data-testid="audit-table">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-4 py-2.5">Waktu</th><th className="px-3 py-2.5">Pengguna</th><th className="px-3 py-2.5">Aksi</th><th className="px-3 py-2.5">Modul</th><th className="px-4 py-2.5">Keterangan</th></tr>
          </thead>
          <tbody>
            {data?.items.map((a) => (
              <tr key={a.id} className="border-t" data-testid={`audit-row-${a.id}`}>
                <td className="num whitespace-nowrap px-4 py-2 text-xs">{waktu(a.at)}</td>
                <td className="px-3 py-2 text-xs">{a.user_name}</td>
                <td className="px-3 py-2"><span className="rounded bg-muted px-1.5 py-0.5 text-xs">{a.action}</span></td>
                <td className="px-3 py-2 text-xs">{a.entity}</td>
                <td className="px-4 py-2 text-xs">{a.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.items.length === 0 && <div className="p-6"><EmptyState>Belum ada catatan.</EmptyState></div>}
      </div>
      {data && data.total > 50 && (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Sebelumnya</Button>
          <Button size="sm" variant="outline" disabled={(page + 1) * 50 >= data.total} onClick={() => setPage((p) => p + 1)}>Berikutnya</Button>
        </div>
      )}
    </div>
  );
}
