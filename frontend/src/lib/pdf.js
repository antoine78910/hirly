import jsPDF from "jspdf";
import {
  PRO_CV_COLORS,
  contactInitials,
  parseLanguageEntry,
  resolveCvDisplayTemplate,
  socialLinksFromContact,
  PROFESSIONAL_CV_TEMPLATE,
} from "./cvTemplate";

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

const safeFilePart = (value, fallback = "document") => {
  const cleaned = String(value || fallback).replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
};

const drawProSectionHeader = (doc, label, x, y, width) => {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  setText(doc, PRO_CV_COLORS.accent);
  doc.text(label.toUpperCase(), x, y);
  setDraw(doc, PRO_CV_COLORS.accent);
  doc.setLineWidth(0.75);
  doc.line(x, y + 3, x + width, y + 3);
  return y + 14;
};

const drawSquareBullet = (doc, x, y) => {
  setFill(doc, PRO_CV_COLORS.accent);
  doc.rect(x, y - 3, 4, 4, "F");
};

const renderProfessionalCV = (doc, { contact = {}, resume = {}, job }) => {
  const name = (contact.name || "Your Name").trim();
  const accent = PRO_CV_COLORS.accent;
  const LEFT_X = 42;
  const LEFT_W = 158;
  const RIGHT_X = 228;
  const RIGHT_W = PAGE_W - RIGHT_X - 42;
  const centerX = PAGE_W / 2;

  setFill(doc, accent);
  doc.rect(0, 0, PAGE_W, 18, "F");
  doc.triangle(centerX - 130, 18, centerX + 130, 18, centerX, 78, "F");

  setFill(doc, "#FFFFFF");
  doc.circle(centerX, 42, 30, "F");
  setFill(doc, PRO_CV_COLORS.photoBg);
  doc.circle(centerX, 42, 27, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  setText(doc, PRO_CV_COLORS.muted);
  doc.text(contactInitials(name), centerX, 47, { align: "center" });

  let headerBottom = 96;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  setText(doc, PRO_CV_COLORS.text);
  doc.text(name, LEFT_X, headerBottom);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setText(doc, PRO_CV_COLORS.muted);
  const headerContact = [contact.email, contact.phone, contact.location].filter(Boolean);
  let contactY = headerBottom - 14;
  headerContact.forEach((line) => {
    doc.text(String(line), PAGE_W - 42, contactY, { align: "right" });
    contactY += 11;
  });

  let leftY = headerBottom + 22;
  let rightY = headerBottom + 22;

  if (job?.title) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    setText(doc, PRO_CV_COLORS.muted);
    doc.text(`Tailored for ${job.title} @ ${job.company}`, LEFT_X, leftY);
    leftY += 14;
    rightY = Math.max(rightY, leftY);
  }

  const ensureColumnRoom = (y, needed) => {
    if (y + needed > PAGE_H - 42) {
      doc.addPage();
      return 42;
    }
    return y;
  };

  leftY = drawProSectionHeader(doc, "Contact", LEFT_X, ensureColumnRoom(leftY, 40), LEFT_W);
  const contactBlocks = [
    ["Address", contact.location],
    ["Phone", contact.phone],
    ["Email", contact.email],
  ].filter(([, value]) => value);
  contactBlocks.forEach(([label, value]) => {
    leftY = ensureColumnRoom(leftY, 28);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    setText(doc, accent);
    doc.text(label.toUpperCase(), LEFT_X, leftY);
    leftY += 10;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setText(doc, PRO_CV_COLORS.text);
    leftY = writeWrapped(doc, String(value), LEFT_X, leftY, LEFT_W, 11);
    leftY += 6;
  });

  const socialLinks = socialLinksFromContact(contact);
  if (socialLinks.length) {
    leftY += 4;
    leftY = drawProSectionHeader(doc, "Social links", LEFT_X, ensureColumnRoom(leftY, 30), LEFT_W);
    socialLinks.forEach((link) => {
      leftY = ensureColumnRoom(leftY, 14);
      drawSquareBullet(doc, LEFT_X, leftY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      setText(doc, PRO_CV_COLORS.text);
      leftY = writeWrapped(doc, link.value, LEFT_X + 10, leftY, LEFT_W - 10, 11);
      leftY += 4;
    });
  }

  if (resume.skills?.length) {
    leftY += 4;
    leftY = drawProSectionHeader(doc, "Skills", LEFT_X, ensureColumnRoom(leftY, 30), LEFT_W);
    resume.skills.forEach((skill) => {
      leftY = ensureColumnRoom(leftY, 14);
      drawSquareBullet(doc, LEFT_X, leftY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      setText(doc, PRO_CV_COLORS.text);
      leftY = writeWrapped(doc, String(skill), LEFT_X + 10, leftY, LEFT_W - 10, 11);
      leftY += 3;
    });
  }

  if (resume.languages?.length) {
    leftY += 4;
    leftY = drawProSectionHeader(doc, "Languages", LEFT_X, ensureColumnRoom(leftY, 30), LEFT_W);
    resume.languages.forEach((entry) => {
      const lang = parseLanguageEntry(entry);
      leftY = ensureColumnRoom(leftY, 12);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      setText(doc, PRO_CV_COLORS.text);
      doc.text(lang.name, LEFT_X, leftY);
      if (lang.level) {
        setText(doc, PRO_CV_COLORS.muted);
        doc.text(lang.level, LEFT_X + LEFT_W, leftY, { align: "right" });
      }
      leftY += 12;
    });
  }

  const rightSection = (title) => {
    rightY += 4;
    rightY = drawProSectionHeader(doc, title, RIGHT_X, ensureColumnRoom(rightY, 30), RIGHT_W);
  };

  if (resume.summary) {
    rightSection("Profile");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    setText(doc, PRO_CV_COLORS.text);
    rightY = writeWrapped(doc, resume.summary, RIGHT_X, rightY, RIGHT_W, 12);
    rightY += 6;
  }

  if (resume.education?.length) {
    rightSection("Education");
    resume.education.forEach((entry) => {
      rightY = ensureColumnRoom(rightY, 34);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      setText(doc, PRO_CV_COLORS.text);
      doc.text(entry.degree || "", RIGHT_X, rightY);
      doc.setFont("helvetica", "normal");
      setText(doc, PRO_CV_COLORS.muted);
      doc.text(entry.year || "", RIGHT_X + RIGHT_W, rightY, { align: "right" });
      rightY += 12;
      doc.setFontSize(9);
      doc.text(entry.school || "", RIGHT_X, rightY);
      rightY += 14;
    });
  }

  if (resume.experience?.length) {
    rightSection("Employment history");
    resume.experience.forEach((entry) => {
      rightY = ensureColumnRoom(rightY, 40);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      setText(doc, PRO_CV_COLORS.text);
      doc.text(entry.role || "", RIGHT_X, rightY);
      doc.setFont("helvetica", "normal");
      setText(doc, PRO_CV_COLORS.muted);
      doc.text(entry.duration || "", RIGHT_X + RIGHT_W, rightY, { align: "right" });
      rightY += 12;
      doc.setFontSize(9);
      doc.text([entry.company, entry.location].filter(Boolean).join(" · "), RIGHT_X, rightY);
      rightY += 12;
      setText(doc, PRO_CV_COLORS.text);
      (entry.highlights || []).forEach((highlight) => {
        rightY = ensureColumnRoom(rightY, 14);
        doc.text("•", RIGHT_X, rightY);
        rightY = writeWrapped(doc, highlight, RIGHT_X + 8, rightY, RIGHT_W - 8, 11);
        rightY += 2;
      });
      rightY += 4;
    });
  }

  if (resume.highlights?.length) {
    rightSection("Extracurricular");
    resume.highlights.forEach((item) => {
      rightY = ensureColumnRoom(rightY, 14);
      doc.text("•", RIGHT_X, rightY);
      rightY = writeWrapped(doc, item, RIGHT_X + 8, rightY, RIGHT_W - 8, 11);
      rightY += 2;
    });
  }
};

/* ====== Tailored CV ====== */
export const downloadTailoredCV = ({ contact = {}, resume = {}, job, template = "modern" }) => {
  const resolved = resolveCvDisplayTemplate(template);
  const doc = newDoc();
  const name = (contact.name || "Your Name").trim();

  if (resolved === PROFESSIONAL_CV_TEMPLATE) {
    renderProfessionalCV(doc, { contact, resume, job });
    doc.save(`CV - ${safeFilePart(name)} - ${safeFilePart(job?.company, "tailored")}.pdf`);
    return;
  }

  const palette = COLORS[template] || COLORS.modern;
  let y = MARGIN_X;
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

  const filename = `CV - ${safeFilePart(name)} - ${safeFilePart(job?.company, "tailored")}.pdf`;
  doc.save(filename);
};

/* ====== Cover Letter ====== */
export const downloadCoverLetter = ({ contact = {}, letter = {}, job, template = "modern" }) => {
  const doc = newDoc();
  const palette = COLORS.modern;
  const company = safeFilePart(letter.recipient_company || job?.company, "Company");
  const name = safeFilePart(contact.name || letter.sender_name || letter.signature_name, "Candidate");
  const useFrench = template === "french_formal" || letter.template === "french_formal" || Boolean(letter.subject);
  let y = MARGIN_X;

  if (useFrench) {
    const senderLines = [
      letter.sender_name || contact.name,
      letter.sender_address || contact.location,
      letter.sender_phone || contact.phone,
      letter.sender_email || contact.email,
    ].filter(Boolean);
    const recipientLines = [
      letter.recipient_attention || "À l'attention du Service des Ressources Humaines",
      letter.recipient_company || job?.company,
      letter.recipient_address || job?.location,
    ].filter(Boolean);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    setText(doc, palette.text);
    senderLines.forEach((line) => {
      doc.text(String(line), MARGIN_X, y);
      y += 14;
    });

    let recipientY = MARGIN_X;
    doc.setFontSize(10);
    recipientLines.forEach((line) => {
      doc.text(String(line), PAGE_W - MARGIN_X, recipientY, { align: "right" });
      recipientY += 14;
    });
    y = Math.max(y, recipientY) + 18;

    const dateLine = letter.date_line || new Date().toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).replace(/^/, "À ").replace(/(\d+) ([^ ]+) (\d+)/, "À $2, le $1 $3");
    doc.text(dateLine.startsWith("À") ? dateLine : `À ${contact.location || "France"}, le ${dateLine}`, MARGIN_X, y);
    y += 22;

    const subject = letter.subject || `Candidature pour le poste de ${job?.title || "ce poste"} - ${company}`;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    y = writeWrapped(doc, `Objet : ${subject}`, MARGIN_X, y, PAGE_W - MARGIN_X * 2, 16);
    y += 16;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    setText(doc, palette.text);
    doc.text(letter.greeting || "Madame, Monsieur,", MARGIN_X, y);
    y += 18;

    (letter.paragraphs || []).forEach((paragraph) => {
      y = writeWrapped(doc, paragraph, MARGIN_X, y, PAGE_W - MARGIN_X * 2, 15);
      y += 12;
    });

    y += 4;
    y = writeWrapped(
      doc,
      letter.sign_off || "Je vous prie de recevoir, Madame, Monsieur, l'expression de mes sincères salutations.",
      MARGIN_X,
      y,
      PAGE_W - MARGIN_X * 2,
      15,
    );
    y += 24;
    doc.setFont("helvetica", "bold");
    doc.text(letter.signature_name || contact.name || name, MARGIN_X, y);

    doc.save(`Lettre de motivation - ${name} - ${company}.pdf`);
    return;
  }

  y = MARGIN_X + 6;
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

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  setText(doc, palette.text);
  doc.text(letter.greeting || `Dear ${job?.company || "Hiring"} team,`, MARGIN_X, y);
  y += 20;

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

  doc.save(`Cover Letter - ${name} - ${company}.pdf`);
};
