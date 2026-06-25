import { TrainingLocaleProvider } from "../../context/TrainingLocaleContext";

/** Training pages at /training — always French. */
export default function TrainingLayoutDefault({ children }) {
  return (
    <TrainingLocaleProvider>
      {children}
    </TrainingLocaleProvider>
  );
}
