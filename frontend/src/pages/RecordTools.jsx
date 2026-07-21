import { useEffect } from "react";
import RecordToolsAccessGate from "../components/recordTools/RecordToolsAccessGate";
import Mp3InterviewSimulator from "../components/recordTools/Mp3InterviewSimulator";

function useRecordToolsDocumentScroll() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("root");
    const app = document.querySelector(".App");

    html.classList.add("record-tools-page-active", "document-scroll");
    body.classList.add("record-tools-page", "document-scroll");
    root?.classList.add("document-scroll");
    app?.classList.add("document-scroll");
    html.classList.remove("app-shell-locked");
    body.classList.remove("app-shell-locked");

    return () => {
      html.classList.remove("record-tools-page-active", "document-scroll");
      body.classList.remove("record-tools-page", "document-scroll");
      root?.classList.remove("document-scroll");
      app?.classList.remove("document-scroll");
    };
  }, []);
}

export default function RecordTools() {
  useRecordToolsDocumentScroll();

  return (
    <RecordToolsAccessGate>
      <div className="min-h-dvh bg-zinc-50 text-zinc-900">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 pb-12 sm:px-6 sm:py-8">
          <Mp3InterviewSimulator />
        </div>
      </div>
    </RecordToolsAccessGate>
  );
}
