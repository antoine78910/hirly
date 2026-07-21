import { useCallback, useEffect, useRef, useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { RefreshCw, Sparkles } from "lucide-react";

import { useAppLocale } from "../../context/AppLocaleContext";
import { backendHasNewerFrontend } from "../../lib/frontendVersion";

export const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;

const COPY = {
  en: {
    eyebrow: "A new Hirly version is ready",
    title: "Let's get you up to date",
    description:
      "We've improved Hirly since you opened the app. Refresh now to get the latest fixes and features.",
    action: "OK, refresh Hirly",
    cancel: "Not now",
  },
  fr: {
    eyebrow: "Une nouvelle version de Hirly est disponible",
    title: "Profitons de la dernière version",
    description:
      "Hirly a été amélioré depuis l'ouverture de l'application. Actualisez maintenant pour bénéficier des derniers correctifs et fonctionnalités.",
    action: "OK, actualiser Hirly",
    cancel: "Pas maintenant",
  },
} as const;

interface FrontendVersionCheckerProps {
  checkForUpdate?: () => Promise<boolean>;
  onRefresh?: () => void;
  intervalMs?: number;
}

export default function FrontendVersionChecker({
  checkForUpdate = backendHasNewerFrontend,
  onRefresh = () => window.location.reload(),
  intervalMs = VERSION_CHECK_INTERVAL_MS,
}: FrontendVersionCheckerProps) {
  const { lang } = useAppLocale();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const checkingRef = useRef(false);
  const updateAvailableRef = useRef(false);

  const check = useCallback(async () => {
    if (checkingRef.current || updateAvailableRef.current) return;
    checkingRef.current = true;
    try {
      if (await checkForUpdate()) {
        updateAvailableRef.current = true;
        setUpdateAvailable(true);
      }
    } finally {
      checkingRef.current = false;
    }
  }, [checkForUpdate]);

  const closeUpdateDialog = useCallback(() => {
    setUpdateAvailable(false);
  }, []);

  useEffect(() => {
    void check();
    const interval = window.setInterval(() => void check(), intervalMs);
    const checkWhenActive = () => {
      if (document.visibilityState === "visible") void check();
    };

    window.addEventListener("focus", checkWhenActive);
    window.addEventListener("online", checkWhenActive);
    document.addEventListener("visibilitychange", checkWhenActive);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", checkWhenActive);
      window.removeEventListener("online", checkWhenActive);
      document.removeEventListener("visibilitychange", checkWhenActive);
    };
  }, [check, intervalMs]);

  const copy = COPY[lang === "fr" ? "fr" : "en"];

  return (
    <AlertDialog.Root
      open={updateAvailable}
      onOpenChange={(open) => {
        if (!open) closeUpdateDialog();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <AlertDialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden border-0 bg-white p-0 shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:rounded-3xl"
          data-testid="frontend-update-dialog"
        >
          <div className="bg-gradient-to-br from-violet-600 via-violet-600 to-indigo-600 px-6 py-7 text-center text-white">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-white/15 shadow-inner">
              <RefreshCw aria-hidden="true" className="h-7 w-7" />
            </div>
            <div className="flex flex-col space-y-2 text-center">
              <p className="flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-violet-100">
                <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
                {copy.eyebrow}
              </p>
              <AlertDialog.Title className="font-display text-2xl font-black tracking-tight text-white">
                {copy.title}
              </AlertDialog.Title>
              <AlertDialog.Description className="text-sm leading-relaxed text-violet-100">
                {copy.description}
              </AlertDialog.Description>
            </div>
          </div>

          <div className="flex flex-col gap-3 px-6 py-5 sm:flex-row sm:justify-center">
            <AlertDialog.Action
              className="gradient-linkedin inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-6 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:w-auto sm:min-w-[220px]"
              data-testid="frontend-update-refresh"
              onClick={onRefresh}
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              {copy.action}
            </AlertDialog.Action>
            <AlertDialog.Cancel
              className="inline-flex h-11 w-full items-center justify-center rounded-full px-6 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:w-auto"
              data-testid="frontend-update-cancel"
              onClick={closeUpdateDialog}
            >
              {copy.cancel}
            </AlertDialog.Cancel>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
