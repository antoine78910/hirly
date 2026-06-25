import { MonitorPlay, ShieldCheck, Sparkles, Coins, Inbox } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { BRAND } from "../../lib/brand";
import { DEMO_CREDITS_MAX } from "../../lib/demoAccount";

export default function DemoWelcomeModal({ open, onOpenChange, onDismiss }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md gap-0 overflow-hidden border-violet-200 p-0 sm:rounded-3xl"
        data-testid="demo-welcome-modal"
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <div className="bg-gradient-to-br from-violet-600 to-indigo-600 px-6 py-7 text-center text-white">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
            <MonitorPlay className="h-6 w-6" />
          </div>
          <DialogHeader className="space-y-2 text-center sm:text-center">
            <DialogTitle className="font-display text-2xl font-black tracking-tight text-white">
              Vous êtes en compte démo
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-violet-100">
              Idéal pour enregistrer votre écran et présenter {BRAND.NAME} à votre audience.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="flex gap-3 rounded-2xl border border-violet-100 bg-violet-50/60 px-4 py-3">
            <Coins className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />
            <div className="text-sm text-zinc-700">
              <p className="font-semibold text-zinc-900">
                {DEMO_CREDITS_MAX} crédits sur votre solde
              </p>
              <p className="mt-1 leading-relaxed text-zinc-600">
                Lorsque votre solde atteint 0, il se réinitialise automatiquement à {DEMO_CREDITS_MAX}.
                En pratique, vous disposez de crédits illimités pour vos démos.
              </p>
            </div>
          </div>

          <div className="flex gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div className="text-sm text-zinc-700">
              <p className="font-semibold text-zinc-900">Aucune candidature réelle envoyée</p>
              <p className="mt-1 leading-relaxed text-zinc-600">
                Pour ne pas déranger les entreprises, un swipe à droite n&apos;envoie jamais votre candidature
                à l&apos;employeur. Tout reste en local sur ce compte.
              </p>
            </div>
          </div>

          <div className="flex gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
            <Inbox className="mt-0.5 h-5 w-5 shrink-0 text-zinc-500" />
            <div className="text-sm text-zinc-700">
              <p className="font-semibold text-zinc-900">Inbox et notifications simulées</p>
              <p className="mt-1 leading-relaxed text-zinc-600">
                Les messages et mises à jour que vous verrez ici sont factices : ils servent uniquement
                à illustrer le fonctionnement de l&apos;application.
              </p>
            </div>
          </div>

          <p className="flex items-center justify-center gap-1.5 text-xs text-zinc-400">
            <Sparkles className="h-3.5 w-3.5" />
            Bonne prise de parole — et merci de faire découvrir {BRAND.NAME} !
          </p>
        </div>

        <DialogFooter className="border-t border-zinc-100 px-6 py-4 sm:justify-center">
          <Button
            type="button"
            className="h-11 w-full rounded-full font-bold sm:w-auto sm:min-w-[200px]"
            onClick={onDismiss}
            data-testid="demo-welcome-dismiss"
          >
            C&apos;est compris, commencer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
