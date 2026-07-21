import { TrainingLocaleProvider } from "../../context/TrainingLocaleContext";

/** The unprefixed legacy training route remains explicitly French. */
export default function TrainingLayoutDefault({ children }) {
  return (
    <TrainingLocaleProvider locale="fr">
      {children}
    </TrainingLocaleProvider>
  );
}
