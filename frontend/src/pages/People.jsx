import { useState } from "react";
import { motion } from "framer-motion";
import { Users, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

const MOCK_PEOPLE = [
  { id: 1, name: "Sarah Chen", title: "Engineering Manager", company: "Linear", appliedRole: "Senior Frontend Engineer", connected: false, gradient: "from-violet-600 to-indigo-600" },
  { id: 2, name: "Marc Dubois", title: "Tech Lead", company: "Stripe", appliedRole: "Backend Engineer", connected: false, gradient: "from-emerald-600 to-cyan-600" },
  { id: 3, name: "Julia Meyer", title: "Senior Recruiter", company: "Vercel", appliedRole: "DevRel Engineer", connected: false, gradient: "from-amber-500 to-orange-500" },
  { id: 4, name: "Tom Richards", title: "CTO", company: "Notion", appliedRole: "Staff Engineer", connected: false, gradient: "from-pink-600 to-rose-600" },
  { id: 5, name: "Amara Osei", title: "Head of Talent", company: "Figma", appliedRole: "Product Designer", connected: false, gradient: "from-blue-600 to-violet-600" },
  { id: 6, name: "Diego Hernández", title: "VP Engineering", company: "Shopify", appliedRole: "Senior Full Stack", connected: false, gradient: "from-green-600 to-teal-600" },
];

function getInitials(name) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function buildMessage(person) {
  return `Hi ${person.name}, I recently applied for the ${person.appliedRole} position at ${person.company} and I'd love to connect with you. I'm very excited about ${person.company}'s work and believe my background would be a great fit. Would you be open to a quick chat?`;
}

function ConnectSheet({ person, open, onOpenChange, onConnected }) {
  const [copied, setCopied] = useState(false);
  const message = buildMessage(person);

  async function handleCopy() {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    toast("Copied!");
    onConnected(person.id);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDone() {
    onConnected(person.id);
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="sprout bg-sprout-surface border-t border-sprout-border rounded-t-2xl px-5 pb-10">
        <SheetHeader className="mb-4 text-left">
          <SheetTitle className="font-display font-bold text-white text-xl">
            Message to {person.name}
          </SheetTitle>
        </SheetHeader>

        <div className="relative rounded-xl bg-sprout-surface-2 border border-sprout-border p-4 text-sm text-sprout-muted leading-relaxed select-all">
          {message}
        </div>

        <div className="mt-4 flex gap-3">
          <Button
            onClick={handleCopy}
            className="flex-1 rounded-full bg-sprout-mint text-white font-semibold gap-2 hover:opacity-90 transition-opacity"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copied!" : "Copy message"}
          </Button>
          <Button
            variant="outline"
            onClick={handleDone}
            className="flex-1 rounded-full border-sprout-border-2 text-white bg-transparent hover:bg-sprout-surface-2 font-semibold transition-colors"
          >
            Done
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PersonCard({ person, index, onConnect }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="flex items-center gap-4 bg-sprout-surface border border-sprout-border rounded-2xl px-4 py-4"
    >
      {/* Avatar */}
      <div
        className={`w-12 h-12 shrink-0 rounded-full bg-gradient-to-br ${person.gradient} grid place-items-center`}
      >
        <span className="font-display font-bold text-white text-sm tracking-wide">
          {getInitials(person.name)}
        </span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-white text-sm leading-tight truncate">{person.name}</p>
        <p className="text-sprout-muted text-xs mt-0.5 truncate">
          {person.title} · {person.company}
        </p>
        <span className="mt-1.5 inline-block text-xs text-sprout-mint font-medium bg-sprout-mint-soft px-2 py-0.5 rounded-full truncate max-w-full">
          Applied to {person.appliedRole}
        </span>
      </div>

      {/* Button */}
      {person.connected ? (
        <button
          disabled
          className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold text-sprout-dim bg-sprout-surface-2 border border-sprout-border cursor-default"
        >
          Sent ✓
        </button>
      ) : (
        <button
          onClick={() => onConnect(person)}
          className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold text-sprout-mint bg-sprout-mint-soft border border-sprout-mint/30 hover:bg-sprout-mint/20 transition-colors"
        >
          Connect
        </button>
      )}
    </motion.li>
  );
}

export default function People() {
  const [people, setPeople] = useState(MOCK_PEOPLE);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  function handleConnect(person) {
    setSelectedPerson(person);
    setSheetOpen(true);
  }

  function handleConnected(id) {
    setPeople((prev) =>
      prev.map((p) => (p.id === id ? { ...p, connected: true } : p))
    );
  }

  function handleSheetChange(open) {
    setSheetOpen(open);
    if (!open) setSelectedPerson(null);
  }

  return (
    <div className="sprout min-h-dvh bg-sprout-bg text-white pb-28">
      <header className="px-5 pt-6 max-w-md mx-auto">
        <h1 className="font-display font-black text-3xl tracking-tighter text-white">People</h1>
        <p className="text-sm text-sprout-muted mt-1">
          {people.length} hiring contact{people.length !== 1 ? "s" : ""} matched to your applications
        </p>
      </header>

      <div className="px-5 mt-5 max-w-md mx-auto">
        {people.length === 0 ? (
          <div className="mt-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-sprout-mint-soft grid place-items-center mx-auto">
              <Users className="w-7 h-7 text-sprout-mint" />
            </div>
            <h3 className="mt-5 font-display font-bold text-2xl">No contacts yet</h3>
            <p className="mt-2 text-sprout-muted text-sm max-w-xs mx-auto">
              Apply to jobs and we'll surface the hiring team for each company.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {people.map((person, i) => (
              <PersonCard
                key={person.id}
                person={person}
                index={i}
                onConnect={handleConnect}
              />
            ))}
          </ul>
        )}
      </div>

      {selectedPerson && (
        <ConnectSheet
          person={selectedPerson}
          open={sheetOpen}
          onOpenChange={handleSheetChange}
          onConnected={handleConnected}
        />
      )}
    </div>
  );
}
