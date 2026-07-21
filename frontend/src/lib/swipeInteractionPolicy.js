// A background feed prefetch must never disable actions on the card currently
// on screen. `loading` can remain true while that request is in flight, but a
// visible card is still safe to swipe.
export function canStartSwipe({ hasJob, appLoading, pendingCardSwipe }) {
  return Boolean(hasJob) && !appLoading && !pendingCardSwipe;
}
