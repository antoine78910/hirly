/**
 * Swiipr S-mark.
 * Sharp zig-zag S, purple (top) → blue (bottom), inspired by the brand asset.
 * Solid fill on dark backgrounds; ships its own gradients in <defs>.
 */
export default function Logo({ size = 28, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-label="Swiipr"
    >
      <defs>
        <linearGradient id="swiipr-top" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%"  stopColor="#A78BFA" />
          <stop offset="55%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#6D28D9" />
        </linearGradient>
        <linearGradient id="swiipr-bot" x1="0.4" y1="0" x2="1" y2="1">
          <stop offset="0%"  stopColor="#6366F1" />
          <stop offset="60%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#2563EB" />
        </linearGradient>
      </defs>

      {/* Top half — purple parallelogram with inset notch (forms upper-right slope of the S) */}
      <path
        d="M52 6 L52 22 L34 22 L18 38 L18 22 Z"
        fill="url(#swiipr-top)"
      />
      {/* Connector / middle band */}
      <path
        d="M18 22 L52 22 L52 30 L36 30 L18 30 Z"
        fill="url(#swiipr-top)"
        opacity="0.95"
      />
      {/* Bottom half — blue parallelogram with inset notch (forms lower-left slope of the S) */}
      <path
        d="M12 58 L12 42 L30 42 L46 26 L46 42 Z"
        fill="url(#swiipr-bot)"
      />
      <path
        d="M12 42 L46 42 L46 34 L30 34 L12 34 Z"
        fill="url(#swiipr-bot)"
        opacity="0.95"
      />
    </svg>
  );
}

export function LogoMark({ size = 36, className = "" }) {
  return (
    <span className={`inline-flex items-center justify-center ${className}`}>
      <Logo size={size} />
    </span>
  );
}
