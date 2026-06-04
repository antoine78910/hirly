import { FileStack } from "lucide-react";
import Sheet from "./Sheet";

/** Documents placeholder — additional uploads (transcripts, portfolios, certs). Coming soon. */
export default function DocumentsSheet({ open, profile: _profile, onClose }) {
  return (
    <Sheet open={open} title="Documents" onClose={onClose} testId="documents-sheet">
      <div className="py-16 text-center">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-sprout-mint-soft-2 grid place-items-center mb-4">
          <FileStack className="w-7 h-7 text-sprout-mint" />
        </div>
        <h3 className="font-display font-bold text-xl">Documents coming soon</h3>
        <p className="mt-2 text-sprout-muted text-sm max-w-xs mx-auto">
          You'll be able to upload transcripts, portfolios, and certifications that we'll attach to your applications automatically.
        </p>
      </div>
    </Sheet>
  );
}
