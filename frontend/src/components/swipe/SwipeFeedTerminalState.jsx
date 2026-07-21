import { MapPin, SlidersHorizontal, Sparkles } from "lucide-react";
import { resolveSwipeFeedSuggestions } from "../../lib/swipeFeedRequestPolicy";

const ACTIONS = {
  preferences: { icon: Sparkles, label: "swipe.feedSuggestionPreferences" },
  location: { icon: MapPin, label: "swipe.feedSuggestionLocation" },
  radius: { icon: MapPin, label: "swipe.feedSuggestionRadius" },
  filters: { icon: SlidersHorizontal, label: "swipe.feedSuggestionFilters" },
};

const copyFor = (state) => {
  switch (state) {
    case "exhausted": return ["swipe.feedExhaustedTitle", "swipe.feedExhaustedBody"];
    case "policy_hidden": return ["swipe.feedPolicyHiddenTitle", "swipe.feedPolicyHiddenBody"];
    case "blocked": return ["swipe.feedBlockedTitle", "swipe.feedBlockedBody"];
    case "no_inventory": return ["swipe.feedNoInventoryTitle", "swipe.feedNoInventoryBody"];
    default: return ["swipe.noJobs", "swipe.tryWidenSearch"];
  }
};

/** Shared mobile/desktop terminal presentation. Its callbacks only open editors. */
export default function SwipeFeedTerminalState({
  state,
  targetLocationData,
  targetLocation,
  filters,
  t,
  onPreferences,
  onLocation,
  onRadius,
  onFilters,
  className = "",
}) {
  const [titleKey, bodyKey] = copyFor(state);
  const actions = resolveSwipeFeedSuggestions({ targetLocationData, targetLocation, filters });
  const callbacks = { preferences: onPreferences, location: onLocation, radius: onRadius, filters: onFilters };
  return (
    <section className={`flex flex-col items-center text-center ${className}`} role="status" aria-live="polite" data-testid={`feed-terminal-${state}`}>
      <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-sprout-mint-soft">
        <Sparkles className="h-7 w-7 text-sprout-mint" aria-hidden="true" />
      </div>
      <h2 className="font-display text-2xl font-bold text-white">{t(titleKey)}</h2>
      <p className="mt-2 max-w-sm text-sm text-sprout-muted">{t(bodyKey)}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {actions.map(({ id }) => {
          if (id === "revisit_later") {
            return <p key={id} className="text-sm text-sprout-muted">{t("swipe.feedSuggestionRevisitLater")}</p>;
          }
          const action = ACTIONS[id];
          const Icon = action.icon;
          return (
            <button key={id} type="button" onClick={callbacks[id]} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-sprout-border bg-sprout-surface px-4 text-sm font-semibold text-sprout-text hover:border-sprout-mint" aria-label={t(action.label)}>
              <Icon className="h-4 w-4 text-sprout-mint" aria-hidden="true" />
              {t(action.label)}
            </button>
          );
        })}
      </div>
    </section>
  );
}
