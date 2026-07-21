import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { resolveAuthReturnPath } from "../lib/authReturnPath";

/** Legacy route — new users go to onboarding, login mode goes to /signin. */
export default function Signup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("mode") === "login") {
      const next = searchParams.get("next");
      const returnPath = next ? resolveAuthReturnPath(next) : null;
      navigate(returnPath ? `/signin?next=${encodeURIComponent(returnPath)}` : "/signin", {
        replace: true,
      });
      return;
    }
    navigate("/onboarding", { replace: true });
  }, [navigate, searchParams]);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-white">
      <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
    </div>
  );
}
