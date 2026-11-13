import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeftRight, BarChart3, ClipboardCheck, FileStack, ReceiptText, FileClock, HandCoins, LayoutDashboard, LogOut, Menu, Moon, Search, Settings2, Sun, Upload, Users, UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMe } from "@/lib/auth";
import { endSession } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", module: "dashboard", icon: LayoutDashboard, end: true },
  { to: "/mutasi", label: "Mutasi Rekening", module: "mutasi", icon: ArrowLeftRight },
  { to: "/donatur", label: "Donatur", module: "donatur", icon: Users },
  { to: "/program", label: "Program Donasi", module: "program", icon: HandCoins },
  { to: "/cicilan", label: "Cek Cicilan", module: "cicilan", icon: ClipboardCheck },
  { to: "/bukti", label: "Bukti Pembayaran", module: "bukti", icon: ReceiptText },
  { to: "/voucher", label: "Voucher", module: "voucher", icon: FileStack },
  { to: "/laporan", label: "Laporan Keuangan", module: "laporan", icon: BarChart3 },
  { to: "/pengguna", label: "Pengguna & PIN", module: "pengguna", icon: UserCog },
  { to: "/audit", label: "Audit Log", module: "audit", icon: FileClock },
  { to: "/pengaturan", label: "Pengaturan", module: "pengaturan", icon: Settings2 },
];

function Brand() {
  return (
    <div className="flex items-center gap-3 px-5 py-5">
      <div className="grid size-10 shrink-0 place-items-center rounded-full border border-amber-400/40 bg-gradient-to-br from-amber-400/20 to-orange-600/30 text-lg text-amber-300">
        廣
      </div>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-sm font-semibold text-white">Dana Paramita</div>
        <div className="truncate text-xs text-slate-400">Guang Ji Indonesia · 廣吉</div>
      </div>
    </div>
  );
}

function NavList({ modules, onNavigate }: { modules: string[]; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1 px-3" data-testid="sidebar-nav">
      {NAV.filter((n) => modules.includes(n.module)).map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={onNavigate}
          data-testid={`nav-${n.module}`}
          className={({ isActive }) =>
            cn(
              "group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors duration-150",
              isActive ? "bg-sidebar-primary text-white shadow-[0_6px_20px_-8px_rgba(234,88,12,0.7)]" : "text-slate-300 hover:bg-sidebar-accent hover:text-white",
            )
          }
        >
          <n.icon className="size-4 shrink-0 opacity-90" />
          <span>{n.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function toggleTheme() {
  const dark = document.documentElement.classList.toggle("dark");
  localStorage.setItem("theme", dark ? "dark" : "light");
}

export default function AppLayout() {
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (me.isError) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  const user = me.data;
  const modules = user?.modules ?? [];

  return (
    <div className="min-h-dvh bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-sidebar lg:flex" data-testid="sidebar">
        <Brand />
        <NavList modules={modules} />
        <div className="mt-auto border-t border-sidebar-border px-5 py-4 text-xs text-slate-500">
          Dana Sosial Keagamaan Buddha Wajib
        </div>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 border-none bg-sidebar p-0 text-white" data-testid="mobile-sidebar">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <Brand />
          <NavList modules={modules} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-xl md:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} data-testid="mobile-menu-button" aria-label="Menu">
            <Menu />
          </Button>
          {modules.includes("donatur") && (
            <form
              className="relative hidden max-w-md flex-1 sm:block"
              onSubmit={(e) => {
                e.preventDefault();
                navigate(`/donatur?q=${encodeURIComponent(q)}`);
              }}
            >
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cari donatur — Latin, 中文, pinyin…"
                className="h-9 bg-card pl-9 pr-14"
                data-testid="global-donor-search"
              />
              <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 text-[10px] text-muted-foreground">Ctrl K</kbd>
            </form>
          )}
          <div className="ml-auto flex items-center gap-2">
            {modules.includes("mutasi") && user?.role !== "auditor" && (
              <Link
                to="/mutasi?upload=1"
                className="hidden h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-[filter,transform] hover:brightness-110 active:scale-[0.98] md:inline-flex"
                data-testid="topbar-upload-mutasi"
              >
                <Upload className="size-4" /> Upload Mutasi
              </Link>
            )}
            <Button variant="ghost" size="icon" onClick={toggleTheme} data-testid="theme-toggle" aria-label="Mode gelap">
              <Sun className="hidden dark:block" />
              <Moon className="dark:hidden" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-3 text-sm transition-colors hover:bg-accent" data-testid="user-menu-trigger">
                <span className="grid size-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {(user?.name ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden max-w-32 truncate md:inline" data-testid="user-menu-name">{user?.name ?? "…"}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel>
                  <div className="font-medium">{user?.name}</div>
                  <div className="text-xs font-normal text-muted-foreground">{user ? ROLE_LABEL[user.role] : ""}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void endSession()} data-testid="logout-button">
                  <LogOut /> Keluar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="px-4 py-6 md:px-8 md:py-8">
          {me.isLoading ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : <Outlet />}
        </main>
      </div>
      <Toaster richColors />
    </div>
  );
}
