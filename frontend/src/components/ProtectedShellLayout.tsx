import { Outlet } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";
import AppShell from "./AppShell";

export default function ProtectedShellLayout() {
  return (
    <ProtectedRoute>
      <AppShell>
        <Outlet />
      </AppShell>
    </ProtectedRoute>
  );
}
