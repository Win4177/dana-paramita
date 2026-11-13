import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { apiPost } from "@/lib/api";
import { beginSession } from "@/lib/session";
import { errMsg } from "@/lib/format";
import type { UserOut } from "@/lib/types";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const done = (u: UserOut) => {
    beginSession();
    toast.success(`Selamat datang, ${u.name}`);
    navigate(u.modules.includes("dashboard") ? "/" : "/cicilan", { replace: true });
  };
  const login = useMutation({ mutationFn: () => apiPost<UserOut>("/auth/login", { email, password }), onSuccess: done, onError: (e) => setError(errMsg(e)) });
  const pinLogin = useMutation({ mutationFn: () => apiPost<UserOut>("/auth/pin", { pin }), onSuccess: done, onError: (e) => setError(errMsg(e)) });

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-[#141D24] p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -right-40 -top-40 size-[520px] rounded-full border border-amber-400/10" />
        <div className="pointer-events-none absolute -right-24 -top-24 size-[380px] rounded-full border border-amber-400/15" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 size-[420px] rounded-full bg-orange-600/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="grid size-12 place-items-center rounded-full border border-amber-400/40 bg-amber-400/10 text-xl text-amber-300">廣</div>
          <div>
            <div className="font-semibold">Yayasan Dana Paramita Guang Ji Indonesia</div>
            <div className="text-sm text-slate-400">印尼廣吉慈善功德基金會</div>
          </div>
        </div>
        <div className="relative mt-auto max-w-lg animate-rise">
          <div className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">Sistem Keuangan & Operasional</div>
          <h1 className="text-4xl font-semibold leading-tight">Pencatatan Dana Paramita yang rapi, tertelusur, dan siap diaudit.</h1>
          <p className="mt-4 text-slate-400">Upload mutasi → kategorikan → OK → terbitkan bukti → laporan. Dana Sosial Keagamaan Buddha Wajib sesuai PER-3/PJ/2023.</p>
          <p className="mt-10 text-sm text-slate-500">隨喜功德 · 福慧雙修</p>
        </div>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm animate-rise">
          <div className="mb-8 lg:hidden">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Dana Paramita Guang Ji</div>
          </div>
          <h2 className="text-2xl font-semibold">Masuk</h2>
          <p className="mb-6 mt-1 text-sm text-muted-foreground">Pengurus memakai email & password. Rekan pengecek cicilan memakai PIN.</p>
          <Tabs defaultValue="email" onValueChange={() => setError("")}>
            <TabsList className="mb-4 w-full">
              <TabsTrigger value="email" data-testid="login-tab-email"><Mail /> Email</TabsTrigger>
              <TabsTrigger value="pin" data-testid="login-tab-pin"><KeyRound /> PIN Rekan</TabsTrigger>
            </TabsList>
            <TabsContent value="email">
              <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setError(""); login.mutate(); }}>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="login-email-input" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required data-testid="login-password-input" />
                </div>
                <Button type="submit" className="w-full" disabled={login.isPending} data-testid="login-submit-button">
                  {login.isPending ? "Memeriksa…" : "Masuk"}
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="pin">
              <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setError(""); pinLogin.mutate(); }}>
                <div className="space-y-1.5">
                  <Label htmlFor="pin">PIN akses</Label>
                  <Input id="pin" inputMode="numeric" type="password" maxLength={12} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="num text-center text-xl tracking-[0.5em]" required data-testid="login-pin-input" />
                </div>
                <Button type="submit" className="w-full" disabled={pinLogin.isPending || pin.length < 4} data-testid="login-pin-submit-button">
                  {pinLogin.isPending ? "Memeriksa…" : "Masuk dengan PIN"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
          {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300" data-testid="login-error">{error}</p>}
        </div>
      </section>
      <Toaster richColors />
    </div>
  );
}
