import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";
import type { Settings, UserOut } from "./types";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => apiGet<UserOut>("/auth/me"), retry: false, staleTime: 60_000 });
}

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/settings"), staleTime: 300_000 });
}

/** Client-side mirror of backend lib/auth.require — UI hints only; the server enforces. */
export function can(user: UserOut | undefined, module: string, action: "read" | "write" | "delete" = "read"): boolean {
  if (!user || !user.modules.includes(module)) return false;
  if (action === "read") return true;
  if (user.role === "auditor") return false;
  if (user.role === "rekan" && module !== "cicilan") return false;
  if (action === "delete" && user.role !== "admin") return false;
  return true;
}
