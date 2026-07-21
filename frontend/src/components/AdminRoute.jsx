import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { devBypassAuth } from "../lib/dev";
import AdminShell, { AdminAccessDenied } from "./admin/AdminShell";

export default function AdminRoute({ children }) {
  const { user, isAdmin, loading } = useAuth();

  if (devBypassAuth) return children;

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!user) return <Navigate to="/" replace />;

  if (!isAdmin) {
    return (
      <AdminShell title="Admin" subtitle="Restricted area">
        <AdminAccessDenied />
        <p className="mt-4 text-center text-sm text-zinc-500">
          Sign in with your admin Google account ({user.email || "unknown"}) or contact support.
        </p>
      </AdminShell>
    );
  }

  return children;
}
