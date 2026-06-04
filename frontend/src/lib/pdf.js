import jsPDF from "jspdf";

/* ============================================================
   Tailored CV / Cover Letter PDF generator.
   We generate clean ATS-friendly PDFs using jsPDF primitives.
   Two templates supported: "modern" (default) and "classic".
   We try to honor the template_style the AI detected on the
   user's original CV. The user's original (raw upload) is also
   downloadable via /api/profile/cv/original.
============================================================ */

const PAGE_W = 595.28; // A4 pts
const PAGE_H = 841.89;
const MARGIN_X = 56;

const COLORS = {
  modern: { name: "#0A66C2", text: "#0A0A0A", muted: "#525252", line: "#E5E7EB" },
  classic: { name: "#111111", text: "#0A0A0A", muted: "#525252", line: "#0A0A0A" },
  minimal: { name: "#111111", text: "#1F2937", muted: "#6B7280", line: "#E5E7EB" },
  two_column: { name: "#0A66C2", text: "#0A0A0A", muted: "#525252", line: "#E5E7EB" },
};

const hexToRgb = (hex) => {
  const v = hex.replace("#", "");
  return {
    r: parseInt(v.substring(0, 2), 16),
    g: parseInt(v.substring(2, 4), 16),
    b: parseInt(v.substring(4, 6), 16),
  };
};

const setFill = (doc, hex) => {
  const { r, g, b } = hexToRgb(hex);
  doc.setFillColor(r, g, b);
};
const setText = (doc, hex) => {
  const { r, g, b } = hexToRgb(hex);
  doc.setTextColor(r, g, b);
};
const setDraw = (doc, hex) => {
  const { r, g, b } = hexToRgb(hex);
  doc.setDrawColor(r, g, b);
};

const newDoc = () => new jsPDF({ unit: "pt", format: "a4", compress: true });

const ensureRoom = (doc, y, needed) => {
  if (y + needed > PAGE_H - MARGIN_X) {
    doc.addPage();
    return MARGIN_X;
  }
  return y;
};

const writeWrapped = (doc, text, x, y, maxW, lineH) => {
  const lines = doc.splitTextToSize(text || "", maxW);
  lines.forEach((line) => {
    y = ensureRoom(doc, y, lineH);
    doc.text(line, x, y);
    y += lineH;
  });
  return y;
};

/* ====== Tailored CV ====== */
export const downloadTailoredCV = ({ contact = {}, resume = {}, job, template = "modern" }) => {
  const doc = newDoc();
  const palette = COLORS[template] || COLORS.modern;
  let y = MARGIN_X;

  const name = (contact.name || "Your Name").trim();
  const contactBits = [contact.email, contact.phone, contact.location, contact.linkedin, contact.website]
    .filter(Boolean);

  if (template === "classic") {
    // Centered serif-style classic
    doc.setFont("times", "bold");
    doc.setFontSize(22);
    setText(doc, palette.name);
    doc.text(name, PAGE_W / 2, y + 12, { align: "center" });
    y += 30;
    doc.setFont("times", "normal");
    doc.setFontSize(10);
    setText(doc, palette.muted);
    doc.text(contactBits.join("  •  "), PAGE_W / 2, y, { align: "center" });
    y += 14;
    setDraw(doc, palette.line);
    doc.setLineWidth(0.75);
    doc.line(MARGIN_X, y + 4, PAGE_W - MARGIN_X, y + 4);
    y += 18;
  } else if (template === "two_column") {
    // Header bar
    setFill(doc, palette.name);
    doc.rect(0, 0, PAGE_W, 70, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    setText(doc, "#FFFFFF");
    doc.text(name, MARGIN_X, 38);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(contactBits.join("   •   "), MARGIN_X, 55);
    y = 96;
  } else {
    // Modern (default) and minimal
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    setText(doc, palette.name);
    doc.text(name, MARGIN_X, y + 12);
    y += 28;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    setText(doc, palette.muted);
    doc.text(contactBits.join("   •   "), MARGIN_X, y);
    y += 18;
    if (template !== "minimal") {
      setDraw(doc, palette.line);
      doc.setLineWidth(0.5);
      doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);
    }
    y += 12;
  }

  const sectionHeader = (label) => {
    y = ensureRoom(doc, y, 30);
    doc.setFont(template === "classic" ? "times" : "helvetica", "bold");
    doc.setFontSize(11);
    setText(doc, palette.name);
    doc.text(label.toUpperCase(), MARGIN_X, y);
    y += 4;
    setDraw(doc, palette.line);
    doc.setLineWidth(0.4);
    doc.line(MARGIN_X, y + 2, PAGE_W - MARGIN_X, y + 2);
    y += 14;
    setText(doc, palette.text);
  };

  // Tailored for line
  if (job?.title) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    setText(doc, palette.muted);
    doc.text(`Tailored for ${job.title} @ ${job.company}`, MARGIN_X, y);
    y += 14;
  }

  // Summary
  if (resume.summary) {
    sectionHeader("Summary");
    doc.setFont(template === "classic" ? "times" : "helvetica", "normal");
    doc.setFontSize(10);
    setText(doc, palette.text);
    y = writeWrapped(doc, resume.summary, MARGIN_X, y, PAGE_W - MARGIN_X * 2, 13);
    y += 8;
  }

  // Skills
  if (resume.skills?.length) {
    sectionHeader("Skills");
    doc.setFontSize(10);
    const skillsLine = resume.skills.join("  ·  ");
    y = writeWrapped(doc, skillsLine, MARGIN_X, y, PAGE_W - MARGIN_X * 2, 13);
    y += 8;
  }

  // Experience
  if (resume.experience?.length) {
    sectionHeader("Experience");
    resume.experience.forEach((e) => {
      y = ensureRoom(doc, y, 50);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      setText(doc, palette.text);
      doc.text(e.role || "", MARGIN_X, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      setText(doc, palette.muted);
      const right = [e.company, e.location].filter(Boolean).join(" — ");
      doc.text(e.duration || "", PAGE_W - MARGIN_X, y, { align: "right" });
      y += 14;
      doc.text(right, MARGIN_X, y);
      y += 12;
      doc.setFontSize(10);
      setText(doc, palette.text);
      (e.highlights || []).forEach((h) => {
        y = ensureRoom(doc, y, 16);
        doc.text("•", MARGIN_X, y);
        y = writeWrapped(doc, h, MARGIN_X + 10, y, PAGE_W - MARGIN_X * 2 - 10, 13);
      });
      y += 6;
    });
  }

  // Education
  if (resume.education?.length) {
    sectionHeader("Education");
    resume.education.forEach((e) => {
      y = ensureRoom(doc, y, 30);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      setText(doc, palette.text);
      doc.text(e.degree || "", MARGIN_X, y);
      doc.setFont("helvetica", "normal");
      setText(doc, palette.muted);
      doc.text(e.year || "", PAGE_W - MARGIN_X, y, { align: "right" });
      y += 13;
      doc.setFontSize(10);
      doc.text(e.school || "", MARGIN_X, y);
      y += 16;
    });
  }

  const filename = `CV - ${name} - ${job?.company || "tailored"}.pdf`;
  doc.save(filename);
};

/* ====== Cover Letter ====== */
export const downloadCoverLetter = ({ contact = {}, letter = {}, job, template = "modern" }) => {
  const doc = newDoc();
  const palette = COLORS[template] || COLORS.modern;
  let y = MARGIN_X + 6;

  const name = (contact.name || "Your Name").trim();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  setText(doc, palette.name);
  doc.text(name, MARGIN_X, y);
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  setText(doc, palette.muted);
  const bits = [contact.email, contact.phone, contact.location].filter(Boolean);
  doc.text(bits.join("   •   "), MARGIN_X, y);
  y += 18;

  setDraw(doc, palette.line);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);
  y += 22;

  // Date
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  doc.setFontSize(10);
  setText(doc, palette.muted);
  doc.text(today, MARGIN_X, y);
  y += 14;

  if (job?.company) {
    doc.text(`Hiring Team — ${job.company}`, MARGIN_X, y);
    y += 12;
    if (job?.location) {
      doc.text(job.location, MARGIN_X, y);
      y += 14;
    }
  }
  y += 8;

  // Greeting
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  setText(doc, palette.text);
  doc.text(letter.greeting || `Dear ${job?.company || "Hiring"} team,`, MARGIN_X, y);
  y += 20;

  // Paragraphs
  doc.setFontSize(10.5);
  (letter.paragraphs || []).forEach((p) => {
    y = writeWrapped(doc, p, MARGIN_X, y, PAGE_W - MARGIN_X * 2, 15);
    y += 12;
  });

  y += 6;
  doc.text(letter.sign_off || "Warm regards,", MARGIN_X, y);
  y += 28;
  doc.setFont("helvetica", "bold");
  doc.text(name, MARGIN_X, y);

  const filename = `Cover Letter - ${name} - ${job?.company || "letter"}.pdf`;
  doc.save(filename);
};
