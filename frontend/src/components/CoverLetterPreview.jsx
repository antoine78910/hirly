import { motion } from "framer-motion";

export default function CoverLetterPreview({ contact = {}, letter = {}, job }) {
  const name = (contact.name || "Your Name").trim();
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="bg-sprout-surface-2 border border-sprout-border rounded-2xl overflow-hidden"
      data-testid="cover-letter-preview"
    >
      <div className="px-6 pt-6">
        <h2 className="font-display font-black text-2xl tracking-tight text-sprout-mint">{name}</h2>
        <p className="text-xs text-sprout-muted mt-1">
          {[contact.email, contact.phone, contact.location].filter(Boolean).join("   •   ")}
        </p>
        <div className="mt-3 border-t border-sprout-border" />
      </div>
      <div className="px-6 py-6 text-zinc-200 text-sm leading-relaxed">
        <p className="text-sprout-muted text-xs">{today}</p>
        {job?.company && (
          <p className="mt-3 text-zinc-100">Hiring Team — {job.company}<br /><span className="text-sprout-muted text-xs">{job.location}</span></p>
        )}
        <p className="mt-5">{letter.greeting || `Dear ${job?.company || "Hiring"} team,`}</p>
        <div className="mt-3 space-y-3">
          {(letter.paragraphs || []).map((p, i) => (<p key={i}>{p}</p>))}
        </div>
        <p className="mt-5">{letter.sign_off || "Warm regards,"}</p>
        <p className="mt-3 font-semibold text-white">{name}</p>
      </div>
    </motion.div>
  );
}
