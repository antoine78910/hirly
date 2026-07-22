import { FileStack, Upload } from "lucide-react";
import { toast } from "sonner";
import Sheet from "./Sheet";
import { useAppLocale } from "../context/AppLocaleContext";

/** Additional documents upload — transcripts, portfolios, certs (coming soon). */
export default function DocumentsSheet({ open, profile: _profile, onClose }) {
  const { t } = useAppLocale();

  const handleUpload = () => {
    toast.message(t("profile.documents.uploadSoon"));
  };

  return (
    <Sheet
      open={open}
      title={t("profile.documents.additionalTitle")}
      onClose={onClose}
      testId="documents-sheet"
    >
      <div className="py-10 text-center">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-violet-50">
          <FileStack className="h-7 w-7 text-linkedin" />
        </div>
        <h3 className="font-display text-xl font-bold text-zinc-900">
          {t("profile.documents.noAdditional")}
        </h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-zinc-500">
          {t("profile.documents.noAdditionalDesc")}
        </p>
        <button
          type="button"
          onClick={handleUpload}
          className="mt-6 inline-flex items-center gap-2 rounded-full gradient-linkedin px-5 py-2.5 text-sm font-semibold text-white"
          data-testid="documents-upload-btn"
        >
          <Upload className="h-4 w-4" />
          {t("profile.documents.uploadDocument")}
        </button>
      </div>
    </Sheet>
  );
}
