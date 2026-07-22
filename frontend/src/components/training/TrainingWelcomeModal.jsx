import { BookOpen, GraduationCap, ShieldAlert, Sparkles } from "lucide-react";
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

export default function TrainingWelcomeModal({ open, onOpenChange, onDismiss }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md flex-col gap-0 overflow-hidden border-violet-200 p-0 sm:rounded-3xl"
        data-testid="training-welcome-modal"
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <div className="shrink-0 bg-gradient-to-br from-violet-600 to-indigo-600 px-6 py-6 text-center text-white sm:py-7">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
            <GraduationCap className="h-6 w-6" />
          </div>
          <DialogHeader className="space-y-2 text-center sm:text-center">
            <DialogTitle className="font-display text-2xl font-black tracking-tight text-white">
              Bienvenue dans la formation
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-violet-100">
              Ton accès au programme créateur {BRAND.NAME} est activé. Tu peux commencer le cours
              dès maintenant.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-5">
          <div className="flex gap-3 rounded-2xl border border-violet-100 bg-violet-50/60 px-4 py-3">
            <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />
            <div className="text-sm text-zinc-700">
              <p className="font-semibold text-zinc-900">Job Search Mastery</p>
              <p className="mt-1 leading-relaxed text-zinc-600">
                Parcours les modules, regarde les vidéos et valide les quiz à la fin de chaque
                chapitre.
              </p>
            </div>
          </div>

          <div className="flex gap-3 rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div className="text-sm text-zinc-700">
              <p className="font-semibold text-zinc-900">Accès confidentiel</p>
              <p className="mt-1 leading-relaxed text-zinc-600">
                Ne partage pas ton accès ni le contenu de la formation. Tout partage détecté
                entraîne une exclusion immédiate du programme.
              </p>
            </div>
          </div>

          <p className="flex items-center justify-center gap-1.5 text-xs text-zinc-400">
            <Sparkles className="h-3.5 w-3.5" />
            Bon courage pour la suite !
          </p>
        </div>

        <DialogFooter className="shrink-0 border-t border-zinc-100 px-6 py-4 sm:justify-center">
          <Button
            type="button"
            className="h-11 w-full rounded-full font-bold sm:w-auto sm:min-w-[200px]"
            onClick={onDismiss}
            data-testid="training-welcome-dismiss"
          >
            Commencer la formation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
