import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, UserCheck } from "lucide-react";
import { exitImpersonation, getAdminToken } from "../lib/api";
import { useAuth } from "../context/AuthContext";

export default function ImpersonationBanner() {
  const { user, checkAuth } = useAuth();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    setVisible(Boolean(getAdminToken()));
  }, [user]);

  if (!visible) return null;

  const handleExit = async () => {
    setExiting(true);
    try {
      exitImpersonation();
      await checkAuth();
      navigate("/admin/users", { replace: true });
    } finally {
      setExiting(false);
      setVisible(false);
    }
  };

  return (
    <div className="fixed inset-x-0 top-0 z-[9999] flex items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-white shadow-lg">
      <div className="flex min-w-0 items-center gap-2">
        <UserCheck className="h-4 w-4 shrink-0" />
        <span className="truncate text-sm font-semibold">
          Viewing as{user?.name ? ` ${user.name}` : ""}
          {user?.email ? ` (${user.email})` : ""}
        </span>
        <span className="hidden rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium sm:inline">
          Admin impersonation
        </span>
      </div>
      <button
        type="button"
        onClick={handleExit}
        disabled={exiting}
        className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-sm font-semibold transition-colors hover:bg-white/30 disabled:opacity-60"
      >
        <LogOut className="h-3.5 w-3.5" />
        {exiting ? "Exiting…" : "Exit"}
      </button>
    </div>
  );
}
