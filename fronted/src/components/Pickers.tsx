import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, UserRound } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiGet } from "@/lib/api";
import type { Donor, Program } from "@/lib/types";
import { cn } from "@/lib/utils";

const NONE = "__none";

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function DonorPicker({
  value, label, onChange, disabled, testId, placeholder = "Pilih donatur",
}: {
  value: string | null; label: string; onChange: (d: Donor | null) => void; disabled?: boolean; testId: string; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const donors = useQuery({ queryKey: ["donors", "picker", dq], queryFn: () => apiGet<Donor[]>(`/donors?limit=30&q=${encodeURIComponent(dq)}`), enabled: open });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        data-testid={testId}
        className={cn(
          "flex h-8 w-full min-w-40 items-center gap-1.5 rounded-md border border-transparent px-2 text-left text-sm transition-colors hover:border-input hover:bg-card disabled:cursor-not-allowed disabled:opacity-60",
          !label && "text-muted-foreground",
        )}
      >
        <UserRound className="size-3.5 shrink-0 opacity-60" />
        <span className="truncate">{label || placeholder}</span>
        <ChevronsUpDown className="ml-auto size-3.5 shrink-0 opacity-40" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ketik nama / 中文 / pinyin" className="mb-2 h-8" data-testid={`${testId}-search`} />
        <div className="max-h-64 overflow-y-auto">
          {value && (
            <button type="button" className="w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent" onClick={() => { onChange(null); setOpen(false); }} data-testid={`${testId}-clear`}>
              Kosongkan donatur
            </button>
          )}
          {donors.isLoading && <div className="px-2 py-3 text-xs text-muted-foreground">Memuat…</div>}
          {donors.data?.length === 0 && <div className="px-2 py-3 text-xs text-muted-foreground">Tidak ditemukan</div>}
          {donors.data?.map((d) => (
            <button
              type="button"
              key={d.id}
              onClick={() => { onChange(d); setOpen(false); }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
              data-testid={`${testId}-option-${d.id}`}
            >
              <Check className={cn("size-3.5", value === d.id ? "opacity-100" : "opacity-0")} />
              <span className="truncate">{d.name_latin}</span>
              {d.name_mandarin && <span className="text-muted-foreground">{d.name_mandarin}</span>}
              {d.bank_accounts[0] && <span className="ml-auto truncate text-[10px] uppercase text-muted-foreground">{d.bank_accounts[0]}</span>}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function usePrograms() {
  return useQuery({ queryKey: ["programs", "options"], queryFn: () => apiGet<Program[]>("/programs/options"), staleTime: 60_000 });
}

export function ProgramSelect({
  value, onChange, disabled, testId, className,
}: { value: string | null; onChange: (id: string | null) => void; disabled?: boolean; testId: string; className?: string }) {
  const programs = usePrograms();
  const names = Object.fromEntries((programs.data ?? []).map((p) => [p.id, p.name]));
  return (
    <Select value={value ?? NONE} onValueChange={(v: string) => onChange(v === NONE ? null : v)} disabled={disabled}>
      <SelectTrigger size="sm" className={cn("h-8 w-full min-w-40 border-transparent bg-transparent shadow-none hover:border-input", className)} data-testid={testId}>
        <SelectValue>{(v) => (v === NONE || !v ? <span className="text-muted-foreground">Pilih program</span> : names[v as string] ?? "…")}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>— Tanpa program —</SelectItem>
        {programs.data?.map((p) => (
          <SelectItem key={p.id} value={p.id} data-testid={`${testId}-option-${p.id}`}>
            {p.name} {p.kind === "cicilan" ? "· cicilan" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
