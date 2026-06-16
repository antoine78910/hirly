import { AlertTriangle, Info } from "lucide-react";

function Callout({ variant, text }) {
  const isWarning = variant === "warning";
  return (
    <div
      className={
        isWarning
          ? "flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          : "flex gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-900"
      }
    >
      {isWarning ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
      ) : (
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
      )}
      <p className="leading-relaxed">{text}</p>
    </div>
  );
}

function DocBlock({ block }) {
  if (!block?.type) return null;

  switch (block.type) {
    case "callout":
      return <Callout variant={block.variant} text={block.text} />;
    case "heading": {
      const level = block.level || 2;
      if (level === 1) {
        return <h2 className="font-display text-2xl font-bold tracking-tight text-zinc-900">{block.text}</h2>;
      }
      if (level === 3) {
        return <h4 className="text-base font-semibold text-zinc-900">{block.text}</h4>;
      }
      return <h3 className="text-lg font-semibold text-zinc-900">{block.text}</h3>;
    }
    case "paragraph":
      return <p className="leading-relaxed text-zinc-700">{block.text}</p>;
    case "list": {
      const Tag = block.style === "numbered" ? "ol" : "ul";
      const listClass = block.style === "numbered"
        ? "list-decimal space-y-1.5 pl-5 text-zinc-700"
        : "list-disc space-y-1.5 pl-5 text-zinc-700";
      return (
        <Tag className={listClass}>
          {(block.items || []).map((item) => (
            <li key={item} className="leading-relaxed">{item}</li>
          ))}
        </Tag>
      );
    }
    default:
      return null;
  }
}

export default function ModuleDocView({ blocks }) {
  if (!blocks?.length) return null;

  return (
    <article className="space-y-4">
      {blocks.map((block, index) => (
        <DocBlock key={`${block.type}-${index}`} block={block} />
      ))}
    </article>
  );
}
