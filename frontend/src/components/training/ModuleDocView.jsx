import { AlertTriangle, ExternalLink, Info } from "lucide-react";
import TrainingShortVideo from "./TrainingShortVideo";
import SocialExampleGrid from "./SocialExampleGrid";
import TrainingDocTable from "./TrainingDocTable";
import TrainingThemeSidebar from "./TrainingThemeSidebar";
import TrainingContentBankFolds from "./TrainingContentBankFolds";

const URL_PATTERN = /(https?:\/\/[^\s<]+[^\s<.,;:!?])/g;
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;

function RichText({ text, className = "" }) {
  if (!text) return null;

  const parts = [];
  let lastIndex = 0;
  let match;

  const combined = new RegExp(`${MARKDOWN_LINK_PATTERN.source}|${URL_PATTERN.source}`, "g");

  while ((match = combined.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[0].startsWith("[")) {
      parts.push(
        <a
          key={`md-${match.index}`}
          href={match[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-900"
        >
          {match[1]}
        </a>,
      );
    } else {
      parts.push(
        <a
          key={`url-${match.index}`}
          href={match[0]}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-900 break-all"
        >
          {match[0]}
        </a>,
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  if (parts.length === 1 && typeof parts[0] === "string") {
    return (
      <span className={className}>
        {text.split("\n").map((line, i, arr) => (
          <span key={i}>
            {line}
            {i < arr.length - 1 ? <br /> : null}
          </span>
        ))}
      </span>
    );
  }

  return (
    <span className={className}>
      {parts.map((part, i) =>
        typeof part === "string"
          ? part.split("\n").map((line, j, arr) => (
              <span key={`${i}-${j}`}>
                {line}
                {j < arr.length - 1 ? <br /> : null}
              </span>
            ))
          : part,
      )}
    </span>
  );
}

function DocLink({ text, href }) {
  return (
    <p>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-900"
      >
        {text}
        <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
      </a>
    </p>
  );
}

function ListItemContent({ item }) {
  if (typeof item === "string") {
    return <RichText text={item} />;
  }
  if (item?.href) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-900"
      >
        {item.text}
      </a>
    );
  }
  return <RichText text={item?.text || ""} />;
}

function Callout({ variant, text }) {
  const isWarning = variant === "warning";
  return (
    <div
      className={
        isWarning
          ? "flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          : "flex gap-3 rounded-lg border border-violet-200 bg-violet-50/60 px-4 py-3 text-sm text-violet-950"
      }
    >
      {isWarning ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
      ) : (
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" aria-hidden />
      )}
      <p className="leading-relaxed">
        <RichText text={text} />
      </p>
    </div>
  );
}

function DocBlock({ block, lang }) {
  if (!block?.type) return null;

  switch (block.type) {
    case "content_bank_folds":
      return (
        <TrainingContentBankFolds
          folds={block.folds}
          renderBlock={(child, key) => <DocBlock key={key} block={child} lang={lang} />}
        />
      );
    case "accordion":
      return (
        <TrainingThemeSidebar
          items={block.items}
          renderContent={(child, key) => <DocBlock key={key} block={child} lang={lang} />}
        />
      );
    case "short_video":
      return <TrainingShortVideo block={block} lang={lang} />;
    case "example_grid":
      return <SocialExampleGrid items={block.items} lang={lang} />;
    case "table":
      return <TrainingDocTable block={block} />;
    case "callout":
      return <Callout variant={block.variant} text={block.text} />;
    case "link":
      return block.href ? <DocLink text={block.text} href={block.href} /> : null;
    case "heading": {
      const level = block.level || 2;
      if (level === 1) {
        return (
          <h2 className="font-display text-2xl font-bold tracking-tight text-zinc-900">
            {block.text}
          </h2>
        );
      }
      if (level === 3) {
        return <h4 className="text-base font-semibold text-zinc-900">{block.text}</h4>;
      }
      return <h3 className="text-lg font-semibold text-zinc-900">{block.text}</h3>;
    }
    case "paragraph":
      return (
        <p className="leading-relaxed text-zinc-700">
          <RichText text={block.text} />
        </p>
      );
    case "list": {
      const Tag = block.style === "numbered" ? "ol" : "ul";
      const listClass =
        block.style === "numbered"
          ? "list-decimal space-y-1.5 pl-5 text-zinc-700"
          : "list-disc space-y-1.5 pl-5 text-zinc-700";
      return (
        <Tag className={listClass}>
          {(block.items || []).map((item, index) => (
            <li
              key={typeof item === "string" ? item : item.text || index}
              className="leading-relaxed"
            >
              <ListItemContent item={item} />
            </li>
          ))}
        </Tag>
      );
    }
    default:
      return null;
  }
}

export default function ModuleDocView({ blocks, lang = "en" }) {
  if (!blocks?.length) return null;

  return (
    <article className="space-y-4">
      {blocks.map((block, index) => (
        <DocBlock key={`${block.type}-${index}`} block={block} lang={lang} />
      ))}
    </article>
  );
}
