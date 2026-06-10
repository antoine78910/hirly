/**
 * Hirly briefcase mark.
 */
export default function Logo({ size = 28, className = "" }) {
  const src = `${process.env.PUBLIC_URL || ""}/logo.png`;

  return (
    <img
      src={src}
      width={size}
      height={size}
      alt="Hirly"
      className={`inline-block object-contain shrink-0 ${className}`}
      draggable={false}
    />
  );
}

export function LogoMark({ size = 36, className = "" }) {
  return (
    <span className={`inline-flex items-center justify-center ${className}`}>
      <Logo size={size} />
    </span>
  );
}
