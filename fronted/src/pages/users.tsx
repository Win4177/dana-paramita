import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { MODULES, ROLE_LABEL, errMsg, waktu } from "@/lib/format";
import type { PinIssueOut, Role, UserCreate, UserOut } from "@/lib/types";

function UserDialog({ user, open, onOpenChange }: { user: UserOut | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState(user?.email ?? "");
  const [name, setName] = useState(user?.name ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "staf");
  const [password, setPassword] = useState("");
  const [modules, setModules] = useState<string[]>(user?.modules ?? []);
  const save = useMutation({
    mutationFn: () => {
      if (user) return apiPut<UserOut>(`/users/${user.id}`, { name, role, modules, ...(password ? { password } : {}) });
      const body: UserCreate = { email, name, role, password: password || null, modules: modules.length ? modules : null };
      return apiPost<UserOut>("/users", body);
    },
    onSuccess: () => { toast.success("Pengguna tersimpan"); void qc.invalidateQueries({ queryKey: ["users"] }); onOpenChange(false); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="user-dialog">
        <DialogHeader>
          <DialogTitle>{user ? "Ubah pengguna" : "Tambah pengguna"}</DialogTitle>
          <DialogDescription>Atur peran dan modul yang boleh dibuka. Rekan pengecek cicilan masuk memakai PIN.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          {!user && (
            <div className="space-y-1.5"><Label htmlFor="u-email">Email</Label><Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="user-form-email" /></div>
          )}
          <div className="space-y-1.5"><Label htmlFor="u-name">Nama</Label><Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} required data-testid="user-form-name" /></div>
          <div className="space-y-1.5">
            <Label>Peran</Label>
            <Select value={role} onValueChange={(v: string) => { setRole(v as Role); setModules([]); }}>
              <SelectTrigger className="w-full" data-testid="user-form-role"><SelectValue>{(v) => ROLE_LABEL[v as string]}</SelectValue></SelectTrigger>
              <SelectContent>{Object.entries(ROLE_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-pass">{user ? "Password baru (opsional)" : role === "rekan" ? "Password (opsional untuk rekan)" : "Password (min. 8 karakter)"}</Label>
            <Input id="u-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="user-form-password" />
          </div>
          <div>
            <Label className="mb-2 block">Modul yang boleh dibuka {modules.length === 0 && <span className="font-normal text-muted-foreground">(kosong = default peran)</span>}</Label>
            <div className="grid grid-cols-2 gap-2">
              {MODULES.map((m) => (
                <label key={m.key} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={modules.includes(m.key)} onCheckedChange={(c) => setModules((ms) => (c ? [...ms, m.key] : ms.filter((x) => x !== m.key)))} data-testid={`user-form-module-${m.key}`} />
                  {m.label}
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Batal</Button>
            <Button type="submit" disabled={save.isPending} data-testid="user-form-submit">Simpan</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Users() {
  const qc = useQueryClient();
  const me = useMe();
  const [editing, setEditing] = useState<UserOut | null>(null);
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<{ user: UserOut; pin: PinIssueOut } | null>(null);
  const [days, setDays] = useState("");
  const q = useQuery({ queryKey: ["users"], queryFn: () => apiGet<UserOut[]>("/users") });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["users"] });
  const issue = useMutation({
    mutationFn: (u: UserOut) => apiPost<PinIssueOut>(`/users/${u.id}/pin`, { expires_days: days ? Number(days) : null }).then((pin) => ({ user: u, pin })),
    onSuccess: (r) => { setIssued(r); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const revoke = useMutation({ mutationFn: (u: UserOut) => apiDelete<UserOut>(`/users/${u.id}/pin`), onSuccess: () => { toast.success("PIN dicabut"); refresh(); }, onError: (e) => toast.error(errMsg(e)) });
  const toggleActive = useMutation({ mutationFn: (u: UserOut) => apiPut<UserOut>(`/users/${u.id}`, { active: !u.active }), onSuccess: refresh, onError: (e) => toast.error(errMsg(e)) });

  return (
    <div>
      <PageHeader
        eyebrow="Akses"
        title="Pengguna & PIN"
        subtitle="Peran: Admin/Ketua/Bendahara (semua modul), Staf Admin (tanpa hapus/kunci periode), Rekan Pengecek Cicilan (PIN), Auditor (hanya lihat)."
        actions={<Button onClick={() => setCreating(true)} data-testid="add-user-button"><Plus /> Tambah pengguna</Button>}
      />
      <div className="mb-3 flex items-center gap-2 text-sm">
        <Label htmlFor="pin-days" className="text-muted-foreground">Masa berlaku PIN baru (hari, kosong = tanpa batas)</Label>
        <Input id="pin-days" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} className="h-8 w-20" data-testid="pin-expiry-days" />
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[820px] text-sm" data-testid="users-table">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-4 py-2.5">Nama</th><th className="px-3 py-2.5">Peran</th><th className="px-3 py-2.5">Modul</th><th className="px-3 py-2.5">Login terakhir</th><th className="px-4 py-2.5 text-right">Aksi</th></tr>
          </thead>
          <tbody>
            {q.data?.map((u) => (
              <tr key={u.id} className="border-t" data-testid={`user-row-${u.id}`}>
                <td className="px-4 py-2.5">
                  <div className="font-medium">{u.name} {!u.active && <span className="ml-1 rounded bg-muted px-1.5 text-[10px]">nonaktif</span>}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </td>
                <td className="px-3 py-2.5 text-xs">{ROLE_LABEL[u.role]}{u.has_pin && <div className="mt-0.5 text-amber-700 dark:text-amber-300">PIN aktif{u.pin_expires_at ? ` s/d ${u.pin_expires_at.slice(0, 10)}` : ""}</div>}</td>
                <td className="max-w-64 px-3 py-2.5 text-xs text-muted-foreground">{u.modules.map((m) => MODULES.find((x) => x.key === m)?.label ?? m).join(", ")}</td>
                <td className="px-3 py-2.5 text-xs">{u.last_login_at ? waktu(u.last_login_at) : "—"}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  <Button size="xs" variant="outline" className="mr-1" onClick={() => setEditing(u)} data-testid={`user-edit-${u.id}`}>Ubah</Button>
                  {u.role === "rekan" && (
                    <>
                      <Button size="xs" variant="outline" className="mr-1" onClick={() => issue.mutate(u)} data-testid={`user-issue-pin-${u.id}`}><KeyRound /> {u.has_pin ? "PIN baru" : "Buat PIN"}</Button>
                      {u.has_pin && <Button size="xs" variant="outline" className="mr-1" onClick={() => revoke.mutate(u)} data-testid={`user-revoke-pin-${u.id}`}><ShieldOff /> Cabut</Button>}
                    </>
                  )}
                  {u.id !== me.data?.id && (
                    <Button size="xs" variant="ghost" onClick={() => toggleActive.mutate(u)} data-testid={`user-toggle-active-${u.id}`}>{u.active ? "Nonaktifkan" : "Aktifkan"}</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(creating || editing) && <UserDialog key={editing?.id ?? "new"} user={editing} open onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }} />}
      <Dialog open={!!issued} onOpenChange={(o) => !o && setIssued(null)}>
        <DialogContent data-testid="pin-issued-dialog">
          <DialogHeader>
            <DialogTitle>PIN untuk {issued?.user.name}</DialogTitle>
            <DialogDescription>Catat & sampaikan PIN ini sekarang — PIN tidak dapat ditampilkan lagi. Admin bisa mencabutnya kapan saja.</DialogDescription>
          </DialogHeader>
          <div className="num rounded-xl bg-muted py-6 text-center text-4xl tracking-[0.4em]" data-testid="issued-pin-value">{issued?.pin.pin}</div>
          {issued?.pin.pin_expires_at && <p className="text-center text-sm text-muted-foreground">Berlaku s/d {issued.pin.pin_expires_at.slice(0, 10)}</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
