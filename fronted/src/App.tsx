import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { RequireModule } from "@/components/common";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Mutasi from "@/pages/Mutasi";
import Donors from "@/pages/Donors";
import DonorDetail from "@/pages/DonorDetail";
import { ProgramDetail, Programs } from "@/pages/Programs";
import Cicilan from "@/pages/Cicilan";
import Users from "@/pages/Users";
import AuditLog from "@/pages/AuditLog";
import Settings from "@/pages/Settings";
import Receipts from "@/pages/Receipts";
import Vouchers from "@/pages/Vouchers";
import Reports from "@/pages/Reports";

const guard = (module: string, el: React.ReactNode) => <RequireModule module={module}>{el}</RequireModule>;

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={guard("dashboard", <Dashboard />)} />
        <Route path="/mutasi" element={guard("mutasi", <Mutasi />)} />
        <Route path="/donatur" element={guard("donatur", <Donors />)} />
        <Route path="/donatur/:id" element={guard("donatur", <DonorDetail />)} />
        <Route path="/program" element={guard("program", <Programs />)} />
        <Route path="/program/:id" element={guard("program", <ProgramDetail />)} />
        <Route path="/cicilan" element={guard("cicilan", <Cicilan />)} />
        <Route path="/bukti" element={guard("bukti", <Receipts />)} />
        <Route path="/voucher" element={guard("voucher", <Vouchers />)} />
        <Route path="/laporan" element={guard("laporan", <Reports />)} />
        <Route path="/pengguna" element={guard("pengguna", <Users />)} />
        <Route path="/audit" element={guard("audit", <AuditLog />)} />
        <Route path="/pengaturan" element={guard("pengaturan", <Settings />)} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
