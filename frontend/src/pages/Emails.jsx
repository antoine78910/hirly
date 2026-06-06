import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Mail, Sparkles, Copy, Check, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS = [
  { key: "sent", label: "Sent" },
  { key: "drafts", label: "Drafts" },
  { key: "replies", label: "Replies" },
];

const MOCK_JOBS = [
  { id: 1, company: "Linear", role: "Senior Frontend Engineer", contact: "Sarah Chen" },
  { id: 2, company: "Stripe", role: "Backend Engineer", contact: "Marc Dubois" },
  { id: 3, company: "Vercel", role: "DevRel Engineer", contact: "Julia Meyer" },
  { id: 4, company: "Notion", role: "Staff Engineer", contact: "Tom Richards" },
];

const MOCK_SENT = [
  {
    id: 1,
    to: "Sarah Chen",
    company: "Linear",
    subject: "Re: Senior Frontend Engineer role",
    preview:
      "Hi Sarah, I came across your opening at Linear and wanted to reach out directly. I'm very excited about what Linear is building and believe my background aligns strongly with what you're looking for.",
    date: "2h ago",
    status: "replied",
  },
  {
    id: 2,
    to: "Marc Dubois",
    company: "Stripe",
    subject: "Backend Engineer — cold reach",
    preview:
      "Hey Marc, I noticed Stripe is scaling its payments infrastructure team. I'd love to chat about how my experience in distributed systems could add value to what you're building.",
    date: "Yesterday",
    status: "sent",
  },
  {
    id: 3,
    to: "Tom Richards",
    company: "Notion",
    subject: "Staff Engineer opportunity",
    preview:
      "Hi Tom, I've been following Notion's product evolution closely and I'm very passionate about the direction the team is taking. I'd love to discuss the Staff Engineer role in more detail.",
    date: "3 days ago",
    status: "sent",
  },
];

const EMAIL_TYPES = [
  {
    key: "cold",
    emoji: "📩",
    label: "Cold outreach",
    description: "First contact with hiring manager",
  },
  {
    key: "followup",
    emoji: "🔄",
    label: "Follow-up",
    description: "1 week after applying",
  },
  {
    key: "referral",
    emoji: "🤝",
    label: "Referral ask",
    description: "Request intro from network",
  },
  {
    key: "thankyou",
    emoji: "💬",
    label: "Thank you",
    description: "After an interview",
  },
];

const DRAFTS_KEY = "swiipr_email_drafts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateEmailTemplate(type, job) {
  const templates = {
    cold: `Hi ${job.contact},\n\nI recently applied for the ${job.role} position at ${job.company} and wanted to reach out directly. I'm very excited about what ${job.company} is building and believe my background aligns strongly with what you're looking for.\n\nWould you be open to a quick 15-minute chat this week?\n\nBest regards`,
    followup: `Hi ${job.contact},\n\nI applied for the ${job.role} role at ${job.company} last week and wanted to follow up. I remain very interested in the position and would love to discuss how I can contribute to the team.\n\nPlease let me know if you need any additional information.\n\nBest regards`,
    referral: `Hi ${job.contact},\n\nI'm reaching out because I'm very interested in the ${job.role} opportunity at ${job.company}. I'd love to learn more about the team and the role — would you be able to connect me with the hiring team or share any insights about the position?\n\nThank you so much for your time.\n\nBest regards`,
    thankyou: `Hi ${job.contact},\n\nThank you so much for taking the time to speak with me about the ${job.role} position at ${job.company}. I really enjoyed our conversation and I'm even more excited about the opportunity.\n\nI look forward to hearing about the next steps.\n\nBest regards`,
  };
  return templates[type] || templates.cold;
}

function loadDrafts() {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveDrafts(drafts) {
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatusPill({ status }) {
  if (status === "replied") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300">
        Replied
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sprout-mint-soft text-sprout-mint">
      Sent
    </span>
  );
}

function SentEmailRow({ email, onClick }) {
  return (
    <button
      onClick={() => onClick(email)}
      className="w-full text-left rounded-2xl border border-sprout-border bg-sprout-surface p-4 flex items-start gap-3 hover:border-sprout-border-2 transition-colors"
    >
      <div className="w-10 h-10 rounded-full bg-sprout-mint-soft grid place-items-center shrink-0 mt-0.5">
        <Mail className="w-4 h-4 text-sprout-mint" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="text-white text-sm font-semibold">{email.to}</span>
            <span className="text-sprout-muted text-sm"> · </span>
            <span className="text-sprout-mint text-sm font-semibold">{email.company}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-sprout-dim text-xs">{email.date}</span>
            <ChevronRight className="w-3.5 h-3.5 text-sprout-dim" />
          </div>
        </div>
        <p className="mt-0.5 text-white text-sm font-semibold truncate">{email.subject}</p>
        <p className="mt-0.5 text-sprout-muted text-xs line-clamp-2 leading-relaxed">{email.preview}</p>
        <div className="mt-2">
          <StatusPill status={email.status} />
        </div>
      </div>
    </button>
  );
}

function DraftRow({ draft, onCopy, onDelete }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    onCopy(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-2xl border border-sprout-border bg-sprout-surface p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-white text-sm font-semibold truncate">{draft.subject}</p>
          <p className="text-sprout-muted text-xs mt-0.5">{draft.date}</p>
        </div>
        <button
          onClick={() => onDelete(draft.id)}
          className="w-7 h-7 grid place-items-center rounded-full hover:bg-sprout-surface-2 transition-colors shrink-0"
          aria-label="Delete draft"
        >
          <X className="w-3.5 h-3.5 text-sprout-dim" />
        </button>
      </div>
      <p className="text-sprout-muted text-xs line-clamp-3 leading-relaxed whitespace-pre-line">
        {draft.body}
      </p>
      <button
        onClick={handleCopy}
        className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sprout-surface-2 text-sprout-mint text-xs font-semibold hover:bg-sprout-mint-soft transition-colors"
      >
        {copied ? (
          <>
            <Check className="w-3 h-3" /> Copied
          </>
        ) : (
          <>
            <Copy className="w-3 h-3" /> Copy
          </>
        )}
      </button>
    </div>
  );
}

// ─── Generate Sheet ───────────────────────────────────────────────────────────

function GenerateSheet({ open, onClose, onSaveDraft }) {
  const [emailType, setEmailType] = useState("cold");
  const [selectedJobId, setSelectedJobId] = useState(MOCK_JOBS[0].id);
  const [generatedBody, setGeneratedBody] = useState("");
  const [copied, setCopied] = useState(false);

  const selectedJob = MOCK_JOBS.find((j) => j.id === Number(selectedJobId));

  const handleGenerate = () => {
    if (!selectedJob) return;
    const body = generateEmailTemplate(emailType, selectedJob);
    setGeneratedBody(body);
    setCopied(false);
  };

  const handleCopyAndSave = () => {
    if (!generatedBody) return;
    navigator.clipboard.writeText(generatedBody).catch(() => {});
    const typeMeta = EMAIL_TYPES.find((t) => t.key === emailType);
    const draft = {
      id: Date.now(),
      subject: `${typeMeta?.label ?? "Outreach"} — ${selectedJob?.company}`,
      body: generatedBody,
      company: selectedJob?.company,
      date: "Just now",
    };
    onSaveDraft(draft);
    setCopied(true);
    toast.success("Copied and saved as draft");
    setTimeout(() => {
      setCopied(false);
      onClose();
    }, 800);
  };

  // Reset state when sheet closes
  const handleClose = () => {
    setGeneratedBody("");
    setCopied(false);
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && handleClose()}>
      <SheetContent
        side="bottom"
        className="sprout bg-sprout-surface border-sprout-border rounded-t-3xl p-0 max-h-[92dvh] overflow-y-auto"
      >
        <SheetHeader className="px-5 pt-6 pb-4 border-b border-sprout-border text-left">
          <SheetTitle className="font-display font-bold text-xl text-white">
            New outreach email
          </SheetTitle>
        </SheetHeader>

        <div className="px-5 py-5 space-y-6">
          {/* Email type picker */}
          <div>
            <p className="text-sprout-muted text-xs font-semibold uppercase tracking-wider mb-3">
              Email type
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              {EMAIL_TYPES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => { setEmailType(t.key); setGeneratedBody(""); }}
                  className={`text-left p-3.5 rounded-2xl border transition-colors ${
                    emailType === t.key
                      ? "border-sprout-mint bg-sprout-mint-soft"
                      : "border-sprout-border bg-sprout-surface-2 hover:border-sprout-border-2"
                  }`}
                >
                  <span className="text-xl">{t.emoji}</span>
                  <p className="mt-1.5 text-white text-sm font-semibold leading-tight">{t.label}</p>
                  <p className="mt-0.5 text-sprout-muted text-xs leading-snug">{t.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Job picker */}
          <div>
            <p className="text-sprout-muted text-xs font-semibold uppercase tracking-wider mb-3">
              Application
            </p>
            <div className="relative">
              <select
                value={selectedJobId}
                onChange={(e) => { setSelectedJobId(e.target.value); setGeneratedBody(""); }}
                className="w-full appearance-none bg-sprout-surface-2 border border-sprout-border rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-sprout-mint transition-colors"
              >
                {MOCK_JOBS.map((j) => (
                  <option key={j.id} value={j.id} className="bg-sprout-surface">
                    {j.role} · {j.company}
                  </option>
                ))}
              </select>
              <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 rotate-90 w-4 h-4 text-sprout-dim pointer-events-none" />
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            className="w-full h-11 rounded-2xl gradient-linkedin text-white font-semibold text-sm flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            Generate
          </button>

          {/* Generated output */}
          {generatedBody && (
            <div className="space-y-3">
              <p className="text-sprout-muted text-xs font-semibold uppercase tracking-wider">
                Preview
              </p>
              <Textarea
                readOnly
                value={generatedBody}
                className="bg-sprout-surface-2 border-sprout-border text-white text-sm leading-relaxed resize-none min-h-[180px] focus-visible:ring-sprout-mint"
              />
              <div className="flex gap-2.5">
                <button
                  onClick={handleCopyAndSave}
                  className="flex-1 h-11 rounded-2xl gradient-linkedin text-white font-semibold text-sm flex items-center justify-center gap-2"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4" /> Saved
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" /> Copy & Save as Draft
                    </>
                  )}
                </button>
                <button
                  onClick={handleClose}
                  className="h-11 px-5 rounded-2xl bg-sprout-surface-2 text-sprout-muted font-semibold text-sm hover:text-white transition-colors border border-sprout-border"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Safe area bottom spacing */}
          <div className="h-4" />
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Sent Email Detail Sheet ──────────────────────────────────────────────────

function EmailDetailSheet({ email, onClose }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!email) return;
    navigator.clipboard.writeText(email.preview).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Sheet open={!!email} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="bottom"
        className="sprout bg-sprout-surface border-sprout-border rounded-t-3xl p-0 max-h-[80dvh] overflow-y-auto"
      >
        {email && (
          <>
            <SheetHeader className="px-5 pt-6 pb-4 border-b border-sprout-border text-left">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <SheetTitle className="font-display font-bold text-lg text-white leading-tight">
                    {email.subject}
                  </SheetTitle>
                  <p className="text-sprout-muted text-sm mt-1">
                    To <span className="text-sprout-mint font-semibold">{email.to}</span> ·{" "}
                    {email.company} · {email.date}
                  </p>
                </div>
                <StatusPill status={email.status} />
              </div>
            </SheetHeader>
            <div className="px-5 py-5 space-y-4">
              <p className="text-white text-sm leading-relaxed whitespace-pre-line">
                {email.preview}
              </p>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sprout-surface-2 text-sprout-mint text-xs font-semibold hover:bg-sprout-mint-soft transition-colors"
              >
                {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
              </button>
              <div className="h-4" />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Tab content ──────────────────────────────────────────────────────────────

function SentTab() {
  const [selectedEmail, setSelectedEmail] = useState(null);

  return (
    <>
      <div className="space-y-3">
        {MOCK_SENT.map((email) => (
          <SentEmailRow key={email.id} email={email} onClick={setSelectedEmail} />
        ))}
      </div>
      <EmailDetailSheet email={selectedEmail} onClose={() => setSelectedEmail(null)} />
    </>
  );
}

function DraftsTab() {
  const [drafts, setDrafts] = useState([]);

  useEffect(() => {
    setDrafts(loadDrafts());
  }, []);

  const handleCopy = (draft) => {
    navigator.clipboard.writeText(draft.body).catch(() => {});
    toast.success("Copied to clipboard");
  };

  const handleDelete = (id) => {
    const updated = drafts.filter((d) => d.id !== id);
    setDrafts(updated);
    saveDrafts(updated);
    toast.success("Draft deleted");
  };

  if (drafts.length === 0) {
    return (
      <div className="mt-16 text-center">
        <Mail className="w-7 h-7 mx-auto mb-3 text-sprout-dim" />
        <p className="text-sprout-muted text-sm">
          No drafts yet. Generate an outreach email to save a draft.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {drafts.map((draft) => (
        <DraftRow
          key={draft.id}
          draft={draft}
          onCopy={handleCopy}
          onDelete={handleDelete}
        />
      ))}
    </div>
  );
}

function RepliesTab() {
  return (
    <div className="mt-16 text-center">
      <div className="w-16 h-16 rounded-2xl bg-sprout-mint-soft grid place-items-center mx-auto">
        <Mail className="w-7 h-7 text-sprout-mint" />
      </div>
      <h3 className="mt-5 font-display font-bold text-2xl">Connect Gmail</h3>
      <p className="mt-2 text-sprout-muted text-sm max-w-xs mx-auto">
        Sync your inbox to track recruiter replies and follow-up automatically.
      </p>
      <span className="mt-5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sprout-mint-soft text-sprout-mint text-xs font-semibold">
        <Sparkles className="w-3.5 h-3.5" /> Coming soon
      </span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Emails() {
  const [activeTab, setActiveTab] = useState("sent");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [drafts, setDrafts] = useState(loadDrafts());

  const handleSaveDraft = (draft) => {
    const updated = [draft, ...drafts];
    setDrafts(updated);
    saveDrafts(updated);
    // If user is on the drafts tab, the child will re-read from localStorage on next mount,
    // but we keep drafts in state here for the badge count.
  };

  return (
    <div className="sprout min-h-dvh bg-sprout-bg text-white pb-28">
      {/* Header */}
      <header className="px-5 pt-6 max-w-md mx-auto">
        <h1 className="font-display font-black text-3xl tracking-tighter text-white">Emails</h1>
        <p className="text-sm text-sprout-muted mt-1">
          Tailored outreach + recruiter replies, in one inbox.
        </p>
      </header>

      <div className="px-5 mt-5 max-w-md mx-auto space-y-4">
        {/* Generate outreach button */}
        <button
          onClick={() => setGenerateOpen(true)}
          className="w-full flex items-center gap-3 p-4 rounded-2xl gradient-linkedin text-white font-semibold text-sm"
        >
          <Sparkles className="w-4 h-4" />
          Generate outreach email
        </button>

        {/* Tabs */}
        <div className="flex gap-2 p-1 rounded-full bg-sprout-surface border border-sprout-border">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`relative flex-1 h-10 rounded-full text-sm font-semibold transition-colors ${
                activeTab === t.key ? "text-white" : "text-sprout-muted"
              }`}
            >
              {activeTab === t.key && (
                <motion.span
                  layoutId="email-tab-pill"
                  className="absolute inset-0 rounded-full bg-sprout-mint"
                  transition={{ type: "spring", stiffness: 300, damping: 28 }}
                />
              )}
              <span className="relative">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="mt-2">
          {activeTab === "sent" && <SentTab />}
          {activeTab === "drafts" && <DraftsTab key={drafts.length} />}
          {activeTab === "replies" && <RepliesTab />}
        </div>
      </div>

      {/* Generate sheet */}
      <GenerateSheet
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onSaveDraft={handleSaveDraft}
      />
    </div>
  );
}
