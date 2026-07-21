export default function SkeletonCard() {
  return (
    <div
      className="absolute inset-0 bg-white border border-zinc-200 rounded-3xl p-6 overflow-hidden"
      data-testid="skeleton-card"
    >
      <div className="flex items-center justify-between">
        <div className="h-3 w-24 shimmer rounded-full" />
        <div className="h-6 w-20 shimmer rounded-full" />
      </div>
      <div className="mt-5 h-8 w-3/4 shimmer rounded-md" />
      <div className="mt-2 h-8 w-1/2 shimmer rounded-md" />
      <div className="mt-5 flex gap-2">
        <div className="h-6 w-16 shimmer rounded-full" />
        <div className="h-6 w-24 shimmer rounded-full" />
        <div className="h-6 w-20 shimmer rounded-full" />
      </div>
      <div className="mt-6 space-y-2.5">
        <div className="h-3 w-full shimmer rounded" />
        <div className="h-3 w-5/6 shimmer rounded" />
        <div className="h-3 w-4/6 shimmer rounded" />
      </div>
      <div className="mt-6 h-24 shimmer rounded-2xl" />
    </div>
  );
}
