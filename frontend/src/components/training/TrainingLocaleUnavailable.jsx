import { Link, useParams } from "react-router-dom";
import { trainingPath } from "../../lib/trainingRoutes";
import { trainingLocaleUnavailableCopy } from "../../lib/trainingLocaleAvailability";

/** A deliberate non-fallback state for recognized locale routes without training content. */
export default function TrainingLocaleUnavailable() {
  const { locale } = useParams();
  const copy = trainingLocaleUnavailableCopy(locale);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold text-zinc-900">{copy.title}</h1>
      <p className="mt-3 text-zinc-600">{copy.body}</p>
      <Link className="mt-6 font-medium text-violet-700 underline" to={trainingPath("fr")}>
        {copy.action}
      </Link>
    </main>
  );
}
