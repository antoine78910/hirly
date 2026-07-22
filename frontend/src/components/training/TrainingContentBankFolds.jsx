import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../ui/accordion";

function FoldBody({ blocks, renderBlock }) {
  if (!blocks?.length) return null;
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => renderBlock(block, `block-${index}`))}
    </div>
  );
}

function ScriptFolds({ items, renderBlock }) {
  if (!items?.length) return null;

  const defaultOpen = items
    .map((item, index) => (item.defaultOpen ? `script-${index}` : null))
    .filter(Boolean);

  return (
    <Accordion
      type="multiple"
      defaultValue={defaultOpen.length ? defaultOpen : ["script-0"]}
      className="rounded-lg border border-zinc-200/90 bg-zinc-50/40"
    >
      {items.map((item, index) => (
        <AccordionItem
          key={item.title || `script-${index}`}
          value={`script-${index}`}
          className="border-zinc-200/80 px-3 last:border-b-0"
        >
          <AccordionTrigger className="py-3 text-sm font-semibold text-zinc-900 hover:no-underline">
            {item.title}
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <FoldBody blocks={item.blocks} renderBlock={renderBlock} />
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

export default function TrainingContentBankFolds({ folds, renderBlock }) {
  if (!folds?.length) return null;

  const defaultOpen = folds.filter((fold) => fold.defaultOpen).map((fold) => fold.id);

  return (
    <Accordion
      type="multiple"
      defaultValue={defaultOpen.length ? defaultOpen : [folds[0]?.id].filter(Boolean)}
      className="space-y-2"
    >
      {folds.map((fold) => (
        <AccordionItem
          key={fold.id}
          value={fold.id}
          className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
        >
          <AccordionTrigger className="px-4 py-3.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 hover:no-underline sm:px-5 sm:text-base">
            {fold.title}
          </AccordionTrigger>
          <AccordionContent className="border-t border-zinc-100 px-4 pb-5 pt-2 sm:px-5">
            {fold.scriptItems ? (
              <ScriptFolds items={fold.scriptItems} renderBlock={renderBlock} />
            ) : (
              <FoldBody blocks={fold.blocks} renderBlock={renderBlock} />
            )}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
