/**
 * iPhone-style frame for landing page live demos (not just static screenshots).
 */
export default function LandingPhoneFrame({ children, overlay, className = "" }) {
  return (
    <div className={`mx-auto w-full max-w-[320px] ${className}`}>
      <div className="rounded-[2rem] border-[3px] border-zinc-900 bg-zinc-900 p-[5px] shadow-[0_28px_60px_-20px_rgba(124,58,237,0.45)]">
        <div className="relative overflow-hidden rounded-[1.55rem] bg-zinc-100">
          <div className="pointer-events-none absolute left-1/2 top-2 z-20 h-[11px] w-[32%] min-w-[84px] -translate-x-1/2 rounded-full bg-zinc-900" />

          <div className="relative bg-zinc-50 pt-7">
            {children}
          </div>

          {overlay ? (
            <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-[1.55rem]">{overlay}</div>
          ) : null}

          <div className="pointer-events-none absolute bottom-1.5 left-1/2 z-20 h-1 w-10 -translate-x-1/2 rounded-full bg-zinc-900/30" />
        </div>
      </div>
    </div>
  );
}
