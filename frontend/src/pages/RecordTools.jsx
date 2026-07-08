import { AppPage, AppPageScroll } from "../components/app/AppPageShell";
import DesktopPageHeader from "../components/desktop/DesktopPageHeader";
import { APP_CONTENT_WIDTH } from "../lib/desktopLayout";
import RecordToolsAccessGate from "../components/recordTools/RecordToolsAccessGate";
import Mp3InterviewSimulator from "../components/recordTools/Mp3InterviewSimulator";

export default function RecordTools() {
  return (
    <RecordToolsAccessGate>
      <AppPage>
        <AppPageScroll>
          <div className={`${APP_CONTENT_WIDTH} mt-4`}>
            <DesktopPageHeader title="Record tools" subtitle="Internal demo: simulate an interview with auto-advance frames." />
            <Mp3InterviewSimulator />
          </div>
        </AppPageScroll>
      </AppPage>
    </RecordToolsAccessGate>
  );
}

