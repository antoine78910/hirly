import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Mail, Sparkles, Copy, Check, ChevronRight, ChevronLeft, ChevronDown, X, Menu, Settings, Star, Pencil,
  CornerUpLeft, Archive, MoreHorizontal, AlertTriangle, Send,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { BRAND } from "../lib/brand";
import { toast } from "sonner";
import Logo from "../components/Logo";
import CompanyLogo from "../components/CompanyLogo";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AppPage, AppPageScroll } from "../components/app/AppPageShell";
import DesktopPageHeader from "../components/desktop/DesktopPageHeader";
import { APP_CONTENT_WIDTH } from "../lib/desktopLayout";
import { useAppLocale } from "../context/AppLocaleContext";

// ─── Constants ────────────────────────────────────────────────────────────────

const getInboxFilters = (t) => [
  { key: "primary", label: t("emails.primary"), activeClass: "bg-zinc-800 text-white", idleClass: "bg-zinc-100 text-zinc-700" },
  { key: "verification", label: t("emails.verification"), activeClass: "bg-orange-100 text-orange-700", idleClass: "bg-orange-50 text-orange-600" },
  { key: "interview", label: t("emails.interview"), activeClass: "bg-violet-100 text-violet-700", idleClass: "bg-violet-50 text-violet-600" },
  { key: "offer", label: t("emails.offer"), activeClass: "bg-teal-100 text-teal-700", idleClass: "bg-teal-50 text-teal-600" },
];

const INBOX_MESSAGES = [
  {
    id: 2,
    filter: "interview",
    from: "Linear Recruiting",
    subject: "Interview invitation — Senior Frontend Engineer",
    preview: "We'd love to schedule a 30-minute chat with our engineering team next week.",
    body: `Hi Alex,\n\nThank you for applying to the Senior Frontend Engineer role at Linear. We'd love to schedule a 30-minute video chat with our engineering team next week.\n\nPlease reply with your availability (Mon–Thu, 10am–6pm CET) or use the scheduling link in your applicant portal.\n\nBest,\nSarah Chen\nLinear Recruiting`,
    date: "Jun 4",
    starred: true,
  },
  {
    id: 3,
    filter: "verification",
    from: "Stripe Careers",
    subject: "Please verify your email address",
    preview: "Confirm your email to complete your application for Backend Engineer.",
    body: `Hello,\n\nPlease verify your email address to complete your application for Backend Engineer at Stripe.\n\nThis link expires in 48 hours. If you did not apply, you can ignore this message.\n\nStripe Careers`,
    date: "Jun 3",
    starred: false,
  },
  {
    id: 4,
    filter: "offer",
    from: "Raycast HR",
    subject: "Offer letter — Product Designer",
    preview: "Congratulations! We're thrilled to extend an offer to join the Raycast team.",
    body: `Congratulations Alex!\n\nWe're thrilled to extend an offer for the Product Designer position at Raycast. Your portfolio and product sense really stood out throughout the process.\n\nYou'll find the offer letter and benefits summary attached. We'd love a response by Friday.\n\nWelcome to the team,\nRaycast HR`,
    date: "Jun 1",
    starred: true,
  },
  {
    id: 5,
    filter: "primary",
    from: "Vercel Careers",
    subject: "Application received — Full Stack Engineer",
    preview: "Thanks for applying via Hirly. We've received your application and our team is reviewing it.",
    body: `Hi Alex,\n\nThanks for applying to the Full Stack Engineer role at Vercel through ${BRAND.NAME}. We've received your tailored application package and our recruiting team is reviewing it now.\n\nYou'll hear back within 5–7 business days. In the meantime, feel free to explore our engineering blog and open roles.\n\nBest,\nVercel Careers`,
    date: "Jun 5",
    starred: false,
  },
  {
    id: 6,
    filter: "primary",
    company: "Linear",
    from: "Sarah Chen",
    subject: "Re: Senior Frontend Engineer role at Linear",
    preview: "Thanks for reaching out! I'd be happy to chat — how does Thursday at 2pm CET work?",
    body: `Hi Alex,\n\nThanks for your note about the Senior Frontend Engineer role at Linear. I reviewed your background and would love to set up a quick intro call.\n\nWould Thursday at 2:00pm CET work for a 20-minute chat? If not, send a few slots that work for you this week.\n\nLooking forward to it,\nSarah Chen\nLinear Recruiting`,
    date: "Jun 4",
    starred: true,
  },
  {
    id: 7,
    filter: "primary",
    from: "Notion Recruiting",
    subject: "Update on your iOS Engineer application",
    preview: "Thank you for your interest in Notion. After careful review, we've decided not to move forward.",
    body: `Hi Alex,\n\nThank you for taking the time to apply for the iOS Engineer position at Notion and for the thoughtful application you submitted via ${BRAND.NAME}.\n\nAfter reviewing your profile alongside other candidates, we've decided not to move forward at this time. We'd encourage you to apply again if a future role is a closer match.\n\nWe appreciate your interest in Notion and wish you the best in your search.\n\nKind regards,\nNotion Recruiting`,
    date: "Jun 2",
    starred: false,
  },
  {
    id: 8,
    filter: "interview",
    from: "Anthropic Talent",
    subject: "Technical interview — Product Engineer",
    preview: "Your application stood out. We'd like to invite you to a 60-minute technical interview.",
    body: `Hi Alex,\n\nThank you for applying to the Product Engineer role at Anthropic. Your experience shipping product surfaces resonated with our team.\n\nWe'd like to invite you to a 60-minute technical interview focused on frontend architecture and product thinking. You'll meet with two engineers from our product team.\n\nPlease reply with your availability next week (Mon–Fri, 9am–5pm PT) or use the scheduling link below.\n\nBest,\nMaya Patel\nAnthropic Talent`,
    date: "Jun 3",
    starred: false,
  },
  {
    id: 9,
    filter: "interview",
    from: "Linear Recruiting",
    subject: "Reminder: interview tomorrow at 2:00pm CET",
    preview: "Quick reminder about your video interview for Senior Frontend Engineer tomorrow.",
    body: `Hi Alex,\n\nJust a friendly reminder that your video interview for the Senior Frontend Engineer role is scheduled for tomorrow at 2:00pm CET.\n\nJoin link: https://meet.linear.app/interview\n\nPlease have a stable connection and be ready to walk through a recent project. The session will run about 45 minutes.\n\nSee you then,\nSarah Chen\nLinear Recruiting`,
    date: "Jun 4",
    starred: true,
  },
  {
    id: 10,
    filter: "primary",
    from: "Supabase Hiring",
    subject: "Re: Backend Engineer — we'd like to learn more",
    preview: "Your Postgres + TypeScript background looks like a strong fit. Are you open to a short call?",
    body: `Hey Alex,\n\nI came across your application for the Backend Engineer role at Supabase. Your open-source contributions and Postgres experience caught our attention.\n\nWould you be open to a 25-minute call next week to learn more about what you're looking for and walk through the team structure?\n\nReply with a few times that work for you — I'm flexible Tue–Thu.\n\nCheers,\nJames Okonkwo\nSupabase Hiring`,
    date: "May 31",
    starred: false,
  },
  {
    id: 11,
    filter: "verification",
    from: "Greenhouse",
    subject: "Complete your profile for Anthropic",
    preview: "Anthropic uses Greenhouse for applications. Please confirm your work authorization details.",
    body: `Hello Alex,\n\nAnthropic asked us to collect a few additional details to complete your application for Product Engineer.\n\nPlease confirm your work authorization status and expected start date using the secure link below. This takes about 2 minutes.\n\nIf you have questions, reply to this email and we'll help.\n\nGreenhouse Applicant Support`,
    date: "Jun 2",
    starred: false,
  },
  {
    id: 12,
    filter: "primary",
    from: "Stripe Recruiting",
    subject: "Re: DevRel Engineer — next steps",
    preview: "Thanks for applying. We'd like you to complete a short writing exercise before the next round.",
    body: `Hi Alex,\n\nThanks for applying to the DevRel Engineer role at Stripe via ${BRAND.NAME}. We enjoyed your application and would like to move you to the next step.\n\nPlease complete a short writing exercise (technical blog post outline + sample intro) within 5 business days. You'll find the brief in your applicant portal.\n\nLet us know if you need an extension.\n\nBest,\nMarc Dubois\nStripe Recruiting`,
    date: "May 30",
    starred: false,
  },
  {
    id: 1,
    filter: "primary",
    variant: "welcome",
    category: "system",
    from: `The ${BRAND.NAME} Team`,
    subject: `Welcome to ${BRAND.NAME}!`,
    preview: `Welcome to ${BRAND.NAME}! Hey there! We're excited to have you on board…`,
    date: "Jun 5",
    starred: false,
    replyDisabled: true,
  },
];

const sortInboxMessages = (items) =>
  [...items].sort((a, b) => {
    if (a.variant === "welcome") return 1;
    if (b.variant === "welcome") return -1;
    return b.id - a.id;
  });

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
  const { t } = useAppLocale();
  if (status === "replied") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300">
        {t("emails.replied")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sprout-mint-soft text-sprout-mint">
      {t("emails.sent")}
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
  const { t } = useAppLocale();
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
            <Check className="w-3 h-3" /> {t("emails.saved")}
          </>
        ) : (
          <>
            <Copy className="w-3 h-3" /> {t("emails.copy")}
          </>
        )}
      </button>
    </div>
  );
}

// ─── Generate Sheet ───────────────────────────────────────────────────────────

function GenerateSheet({ open, onClose, onSaveDraft }) {
  const { t } = useAppLocale();
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
    toast.success(t("emails.copiedDraft"));
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
            {t("emails.newOutreach")}
          </SheetTitle>
        </SheetHeader>

        <div className="px-5 py-5 space-y-6">
          {/* Email type picker */}
          <div>
            <p className="text-sprout-muted text-xs font-semibold uppercase tracking-wider mb-3">
              {t("emails.emailType")}
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              {EMAIL_TYPES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => { setEmailType(t.key); setGeneratedBody(""); }}
                  className={`text-left p-3.5 rounded-2xl transition-all duration-200 ease-out ${
                    emailType === t.key ? "selection-option-on" : "selection-option-off"
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
              {t("emails.application")}
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
            {t("emails.generate")}
          </button>

          {/* Generated output */}
          {generatedBody && (
            <div className="space-y-3">
              <p className="text-sprout-muted text-xs font-semibold uppercase tracking-wider">
                {t("emails.preview")}
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
                      <Check className="w-4 h-4" /> {t("emails.saved")}
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" /> {t("emails.copySaveDraft")}
                    </>
                  )}
                </button>
                <button
                  onClick={handleClose}
                  className="h-11 px-5 rounded-2xl bg-sprout-surface-2 text-sprout-muted font-semibold text-sm hover:text-white transition-colors border border-sprout-border"
                >
                  {t("common.cancel")}
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

// ─── Inbox message detail ─────────────────────────────────────────────────────

const CATEGORY_BADGES = {
  system: "bg-sky-100 text-sky-900",
  verification: "bg-orange-100 text-orange-800",
  interview: "bg-violet-100 text-violet-800",
  offer: "bg-teal-100 text-teal-800",
};

function canReplyToMessage(message) {
  return !message?.replyDisabled && message?.variant !== "welcome";
}

function getCategoryBadge(message, t) {
  if (message.category === "system" || message.variant === "welcome") {
    return { key: "system", label: t("emails.system") };
  }
  const labels = {
    verification: t("emails.verification"),
    interview: t("emails.interview"),
    offer: t("emails.offer"),
  };
  if (labels[message.filter]) return { key: message.filter, label: labels[message.filter] };
  return null;
}

function SenderAvatar({ message, size = "md" }) {
  const isSystem = message.variant === "welcome" || message.category === "system";
  const logoSize = size === "lg" ? "md" : "sm";
  const box = size === "lg" ? "h-11 w-11" : "h-10 w-10";

  if (isSystem) {
    return (
      <div
        className={`grid ${box} shrink-0 place-items-center rounded-full border border-zinc-200/90 bg-white p-1.5 shadow-sm`}
      >
        <Logo size={size === "lg" ? 28 : 22} />
      </div>
    );
  }

  return (
    <CompanyLogo
      company={message.company || message.from}
      size={logoSize}
      rounded="full"
    />
  );
}

function WelcomeMessageBody() {
  return (
    <article className="space-y-5 text-[15px] leading-[1.55] text-zinc-800">
      <h1 className="font-display text-[26px] font-bold tracking-tight text-zinc-900">
        Welcome to {BRAND.NAME}!
      </h1>
      <p>Hey there! We&apos;re excited to have you on board.</p>
      <p>
        This is your <strong className="font-semibold text-zinc-900">{BRAND.NAME} inbox</strong>
        {" "}&mdash; a dedicated space for all your job search communication. Here&apos;s what you can expect to see here:
      </p>
      <ul className="list-disc space-y-2.5 pl-5 marker:text-zinc-400">
        <li>
          <strong className="font-semibold text-zinc-900">Application confirmations</strong>
          {" "}when you swipe right on a job
        </li>
        <li>
          <strong className="font-semibold text-zinc-900">Interview requests</strong>
          {" "}from companies that want to meet you
        </li>
        <li>
          <strong className="font-semibold text-zinc-900">Job offers</strong>
          {" "}and next steps
        </li>
        <li>
          <strong className="font-semibold text-zinc-900">Important updates</strong>
          {" "}about your applications
        </li>
      </ul>
      <p>Start swiping to apply to jobs, and you&apos;ll see updates appear right here.</p>
      <p>
        Happy Swiping,
        <br />
        <strong className="font-semibold text-zinc-900">The {BRAND.NAME} Team</strong>
      </p>
    </article>
  );
}

function MessageMoreMenu({ open, message, starred, onClose, onToggleStar, onArchive, onMarkUnread, onReport }) {
  if (!message) return null;

  const items = [
    {
      key: "star",
      icon: Star,
      label: starred ? "Unstar" : "Star",
      sub: starred ? "Remove from starred" : "Add to starred",
      onClick: onToggleStar,
      danger: false,
    },
    {
      key: "archive",
      icon: Archive,
      label: "Archive",
      sub: "Move to archive",
      onClick: onArchive,
      danger: false,
    },
    {
      key: "unread",
      icon: Mail,
      label: "Mark as Unread",
      sub: "Mark this thread as not read",
      onClick: onMarkUnread,
      danger: false,
    },
    {
      key: "report",
      icon: AlertTriangle,
      label: "Report",
      sub: "Report this email",
      onClick: onReport,
      danger: true,
    },
  ];

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl border-zinc-200 bg-white p-0"
        data-testid="inbox-more-menu"
      >
        <div className="flex justify-center pt-2">
          <div className="h-1 w-10 rounded-full bg-zinc-200" />
        </div>
        <div className="flex justify-end px-5 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-semibold text-zinc-900"
            data-testid="inbox-more-done"
          >
            Done
          </button>
        </div>
        <ul className="mt-1 divide-y divide-zinc-100 pb-6">
          {items.map(({ key, icon: Icon, label, sub, onClick, danger }) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => {
                  onClick();
                  onClose();
                }}
                className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-zinc-50"
                data-testid={`inbox-more-${key}`}
              >
                <Icon
                  className={`h-6 w-6 shrink-0 ${danger ? "text-rose-500" : "text-zinc-800"}`}
                  strokeWidth={danger ? 2 : 1.75}
                  fill={key === "star" && starred ? "currentColor" : "none"}
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-[15px] font-semibold ${danger ? "text-rose-500" : "text-zinc-900"}`}>
                    {label}
                  </p>
                  <p className="text-sm text-zinc-500">{sub}</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300" />
              </button>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

function ReplySheet({ message, open, onClose, onSend }) {
  const { t } = useAppLocale();
  const [body, setBody] = useState("");

  useEffect(() => {
    if (open) setBody("");
  }, [open, message?.id]);

  if (!message) return null;

  const handleSend = () => {
    const text = body.trim();
    if (!text) {
      toast.error(t("emails.writeReplyFirst"));
      return;
    }
    onSend(text);
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl border-zinc-200 bg-white p-0">
        <SheetHeader className="border-b border-zinc-100 px-5 pb-4 pt-6 text-left">
          <SheetTitle className="font-display text-lg font-bold text-zinc-900">
            {t("emails.reply")} {message.from}
          </SheetTitle>
          <p className="text-sm text-zinc-500">Re: {message.subject}</p>
        </SheetHeader>
        <div className="space-y-4 px-5 py-5">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("emails.writeReply")}
            className="min-h-[140px] resize-none border-zinc-200 text-sm leading-relaxed"
            data-testid="inbox-reply-input"
          />
          <div className="flex gap-2">
            <Button
              onClick={handleSend}
              className="flex-1 rounded-full gradient-linkedin text-white"
              data-testid="inbox-reply-send"
            >
              <Send className="mr-1.5 h-4 w-4" />
              {t("emails.send")}
            </Button>
            <Button variant="outline" onClick={onClose} className="rounded-full border-zinc-200">
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MessageActionBar({ onReply, onMarkUnread, onArchive, onMore }) {
  const actions = [
    { key: "reply", icon: CornerUpLeft, label: "Reply", onClick: onReply },
    { key: "mail", icon: Mail, label: "Mark unread", onClick: onMarkUnread },
    { key: "archive", icon: Archive, label: "Archive", onClick: onArchive },
    { key: "more", icon: MoreHorizontal, label: "More", onClick: onMore },
  ];

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[4.85rem] z-50 flex justify-center px-safe"
      data-testid="inbox-message-actions"
    >
      <div className="pointer-events-auto flex w-full max-w-[280px] items-center justify-around rounded-full border border-zinc-200/80 bg-zinc-100/95 px-1.5 py-1 shadow-sm backdrop-blur-sm">
        {actions.map(({ key, icon: Icon, label, onClick }) => (
          <button
            key={key}
            type="button"
            onClick={onClick}
            className="grid h-7 w-7 place-items-center rounded-full text-zinc-700 transition-colors hover:bg-white/90 active:scale-95"
            aria-label={label}
            data-testid={`inbox-action-${key}`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        ))}
      </div>
    </div>
  );
}

function InboxMessageDetail({
  message,
  starred,
  onClose,
  onToggleStar,
  onMarkUnread,
  onArchive,
  onReport,
  onReplySent,
}) {
  const { t } = useAppLocale();
  const [moreOpen, setMoreOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);

  if (!message) return null;

  const category = getCategoryBadge(message, t);
  const replyAllowed = canReplyToMessage(message);

  const handleReply = () => {
    if (!replyAllowed) {
      toast.message(t("emails.cantReply"));
      return;
    }
    setReplyOpen(true);
  };

  const handleMarkUnread = () => {
    onMarkUnread();
    toast.success(t("emails.markedUnread"));
  };

  const handleArchive = () => {
    onArchive();
    toast.success(t("emails.archived"));
  };

  const handleReport = () => {
    onReport();
    toast.success(t("emails.reportThanks"));
  };

  return (
    <div className="fixed inset-0 z-50 flex h-dvh max-h-dvh flex-col overflow-hidden bg-white text-zinc-900" data-testid="inbox-message-detail">
      <header className="mx-auto w-full max-w-md shrink-0 border-b border-zinc-100 px-safe pb-3 pt-safe sm:px-4">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-0.5 text-[15px] font-medium text-zinc-900"
          data-testid="inbox-message-back"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2} />
          {t("emails.back")}
        </button>

        <div className="mt-3 flex flex-wrap items-start gap-x-2 gap-y-1">
          <h1 className="min-w-0 flex-1 basis-[calc(100%-4.5rem)] font-display text-base font-bold leading-snug text-zinc-900 sm:text-[17px]">
            {message.subject}
          </h1>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleStar}
              className="text-zinc-400 transition-colors hover:text-amber-400"
              aria-label={starred ? "Unstar" : "Star"}
              data-testid="inbox-detail-star"
            >
              <Star className={`h-4 w-4 ${starred ? "fill-amber-400 text-amber-400" : ""}`} />
            </button>
            {category ? (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold sm:text-[11px] ${
                  CATEGORY_BADGES[category.key] || CATEGORY_BADGES.system
                }`}
                data-testid="inbox-category-badge"
              >
                {category.label}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex items-start gap-3">
          <SenderAvatar message={message} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <p className="truncate text-sm font-bold text-zinc-900">{message.from}</p>
              <span className="shrink-0 text-xs text-zinc-400">{message.date}</span>
            </div>
            <button
              type="button"
              className="mt-0.5 inline-flex items-center gap-0.5 text-xs text-zinc-500"
              onClick={() => toast.message("Recipient details coming soon")}
            >
              {t("emails.toMe")}
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-zinc-600 hover:bg-zinc-100"
            aria-label="More options"
            data-testid="inbox-header-more"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="app-scroll no-scrollbar mx-auto min-h-0 w-full max-w-md flex-1 px-5 pb-28 pt-5">
        {message.variant === "welcome" ? (
          <WelcomeMessageBody />
        ) : (
          <article className="space-y-4">
            <p className="whitespace-pre-line text-[15px] leading-[1.55] text-zinc-800">
              {message.body || message.preview}
            </p>
          </article>
        )}
      </div>

      <MessageActionBar
        onReply={handleReply}
        onMarkUnread={handleMarkUnread}
        onArchive={handleArchive}
        onMore={() => setMoreOpen(true)}
      />

      <MessageMoreMenu
        open={moreOpen}
        message={message}
        starred={starred}
        onClose={() => setMoreOpen(false)}
        onToggleStar={() => {
          onToggleStar();
          toast.success(starred ? t("emails.removedStarred") : t("emails.addedStarred"));
        }}
        onArchive={handleArchive}
        onMarkUnread={handleMarkUnread}
        onReport={handleReport}
      />

      <ReplySheet
        message={message}
        open={replyOpen}
        onClose={() => setReplyOpen(false)}
        onSend={(text) => {
          onReplySent(text);
          toast.success(t("emails.replySent"));
        }}
      />
    </div>
  );
}

// ─── Sent Email Detail Sheet ──────────────────────────────────────────────────

function EmailDetailSheet({ email, onClose }) {
  const { t } = useAppLocale();
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
                {copied ? <><Check className="w-3 h-3" /> {t("emails.saved")}</> : <><Copy className="w-3 h-3" /> {t("emails.copy")}</>}
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
  const { t } = useAppLocale();
  const [drafts, setDrafts] = useState([]);

  useEffect(() => {
    setDrafts(loadDrafts());
  }, []);

  const handleCopy = (draft) => {
    navigator.clipboard.writeText(draft.body).catch(() => {});
    toast.success(t("emails.copied"));
  };

  const handleDelete = (id) => {
    const updated = drafts.filter((d) => d.id !== id);
    setDrafts(updated);
    saveDrafts(updated);
    toast.success(t("emails.draftDeleted"));
  };

  if (drafts.length === 0) {
    return (
      <div className="mt-16 text-center">
        <Mail className="w-7 h-7 mx-auto mb-3 text-sprout-dim" />
        <p className="text-sprout-muted text-sm">
          {t("emails.noDrafts")}
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
  const { t } = useAppLocale();
  const navigate = useNavigate();
  const inboxFilters = useMemo(() => getInboxFilters(t), [t]);
  const [filter, setFilter] = useState("primary");
  const [query, setQuery] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [drafts, setDrafts] = useState(loadDrafts());
  const [starred, setStarred] = useState(() =>
    Object.fromEntries(INBOX_MESSAGES.map((m) => [m.id, m.starred])),
  );
  const [read, setRead] = useState(() =>
    Object.fromEntries(INBOX_MESSAGES.map((m) => [m.id, false])),
  );
  const [archived, setArchived] = useState(() =>
    Object.fromEntries(INBOX_MESSAGES.map((m) => [m.id, false])),
  );
  const [selectedMessage, setSelectedMessage] = useState(null);

  const handleSaveDraft = (draft) => {
    const updated = [draft, ...drafts];
    setDrafts(updated);
    saveDrafts(updated);
  };

  const openMessage = (m) => {
    setRead((prev) => ({ ...prev, [m.id]: true }));
    setSelectedMessage(m);
  };

  const closeMessage = () => setSelectedMessage(null);

  const toggleStar = (id) => {
    setStarred((s) => ({ ...s, [id]: !s[id] }));
  };

  const markUnread = (id) => {
    setRead((r) => ({ ...r, [id]: false }));
    closeMessage();
  };

  const archiveMessage = (id) => {
    setArchived((a) => ({ ...a, [id]: true }));
    closeMessage();
  };

  const messages = sortInboxMessages(
    INBOX_MESSAGES.filter((m) => {
      if (archived[m.id]) return false;
      if (m.filter !== filter) return false;
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        m.from.toLowerCase().includes(q)
        || m.subject.toLowerCase().includes(q)
        || m.preview.toLowerCase().includes(q)
      );
    }),
  );

  return (
    <AppPage className="relative bg-white text-zinc-900 md:py-8">
      <header className="mx-auto w-full max-w-md shrink-0 px-safe pt-safe sm:px-4 md:hidden">
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            className="grid h-9 w-9 shrink-0 place-items-center text-zinc-500 sm:h-10 sm:w-10"
            aria-label="Menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex h-10 min-w-0 flex-1 items-center rounded-full bg-zinc-100 px-3 sm:h-11 sm:px-4">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("emails.searchMail")}
              className="w-full min-w-0 bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 outline-none"
              data-testid="inbox-search"
            />
          </div>
          <button
            type="button"
            onClick={() => navigate("/settings")}
            className="grid h-9 w-9 shrink-0 place-items-center text-zinc-500 sm:h-10 sm:w-10"
            aria-label="Settings"
          >
            <Settings className="h-5 w-5" />
          </button>
        </div>

        <div className="-mx-safe mt-3 flex gap-1.5 overflow-x-auto px-safe pb-1 no-scrollbar sm:mx-0 sm:mt-4 sm:gap-2 sm:px-0">
          {inboxFilters.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors sm:px-4 sm:py-2 sm:text-sm ${
                  active ? f.activeClass : f.idleClass
                }`}
                data-testid={`inbox-filter-${f.key}`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </header>

      <AppPageScroll>
        <div className={`${APP_CONTENT_WIDTH} mt-2`}>
          <DesktopPageHeader title={t("emails.inboxTitle")} subtitle={t("emails.inboxSubtitle")} />
          <div className="mb-4 hidden flex-wrap gap-2 md:flex">
            {inboxFilters.map((f) => {
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                    active ? f.activeClass : f.idleClass
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          <p className="mb-2 text-xs font-medium capitalize text-zinc-400 md:mt-0">{filter}</p>
          {messages.length === 0 ? (
            <p className="py-12 text-center text-sm text-zinc-500">{t("emails.emptyFolder")}</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {messages.map((m) => (
                <li key={m.id} data-testid={`inbox-row-${m.id}`}>
                  <div className="flex gap-3 py-4">
                    <button
                      type="button"
                      onClick={() => openMessage(m)}
                      className="flex min-w-0 flex-1 gap-3 text-left transition-colors hover:opacity-90 active:bg-zinc-50 rounded-lg -mx-1 px-1"
                      data-testid={`inbox-open-${m.id}`}
                    >
                      <SenderAvatar message={m} size="lg" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`truncate text-sm ${read[m.id] ? "font-semibold text-zinc-800" : "font-bold text-zinc-900"}`}>
                            {m.from}
                          </p>
                          <span className="shrink-0 text-xs text-zinc-400">{m.date}</span>
                        </div>
                        <p className={`truncate text-sm ${read[m.id] ? "font-medium text-zinc-700" : "font-bold text-zinc-900"}`}>
                          {m.subject}
                        </p>
                        <p className={`mt-0.5 line-clamp-2 text-sm ${read[m.id] ? "text-zinc-500" : "font-medium text-zinc-600"}`}>
                          {m.preview}
                        </p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleStar(m.id);
                      }}
                      className="shrink-0 pt-1 text-zinc-300 hover:text-amber-400"
                      aria-label={starred[m.id] ? "Unstar" : "Star"}
                      data-testid={`inbox-star-${m.id}`}
                    >
                      <Star className={`h-4 w-4 ${starred[m.id] ? "fill-amber-400 text-amber-400" : ""}`} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </AppPageScroll>

      <button
        type="button"
        onClick={() => setGenerateOpen(true)}
        className="fixed bottom-24 right-4 z-40 grid h-12 w-12 place-items-center rounded-full gradient-linkedin text-white shadow-lg hover:opacity-90 sm:right-5 sm:h-14 sm:w-14"
        aria-label={t("emails.composeEmail")}
        data-testid="inbox-compose-fab"
      >
        <Pencil className="h-6 w-6" />
      </button>

      <GenerateSheet
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onSaveDraft={handleSaveDraft}
      />

      <InboxMessageDetail
        message={selectedMessage}
        starred={selectedMessage ? starred[selectedMessage.id] : false}
        onClose={closeMessage}
        onToggleStar={() => selectedMessage && toggleStar(selectedMessage.id)}
        onMarkUnread={() => selectedMessage && markUnread(selectedMessage.id)}
        onArchive={() => selectedMessage && archiveMessage(selectedMessage.id)}
        onReport={() => {}}
        onReplySent={() => {}}
      />
    </AppPage>
  );
}
