import RecordToolsAccessGate from "../components/recordTools/RecordToolsAccessGate";
import Mp3InterviewSimulator from "../components/recordTools/Mp3InterviewSimulator";

export default function RecordTools() {
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
