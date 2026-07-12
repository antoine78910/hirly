import {
  PRO_CV_COLORS,
  PRO_CV_LAYOUT,
  PRO_CV_PAGE,
  contactInitials,
  computeVerticalFillScale,
  estimateProfessionalContentHeight,
  getColumnPositions,
  getContactPhotoUrl,
} from "./cvTemplate";

const HEADER_VIEWBOX = { width: 794, height: 130 };

function scaleHeaderPoint(x, y) {
  const sx = PRO_CV_PAGE.widthPt / HEADER_VIEWBOX.width;
  const sy = 97 / HEADER_VIEWBOX.height;
  return [x * sx, y * sy];
}

/** Draw the curved blue collar header (matches preview SVG). */
export function drawProfessionalHeaderShape(doc, setFill) {
  const accent = PRO_CV_COLORS.accent;
  setFill(doc, accent);

  const [x0, y0] = scaleHeaderPoint(0, 0);
  const [x794, y0b] = scaleHeaderPoint(794, 0);
  const [x794b, y24] = scaleHeaderPoint(794, 24);
  const [x548, y24b] = scaleHeaderPoint(548, 24);
  const [x397, y108] = scaleHeaderPoint(397, 108);
  const [x246, y24c] = scaleHeaderPoint(246, 24);
  const [x0b, y24d] = scaleHeaderPoint(0, 24);

  doc.triangle(x0, y0, x794, y0b, x794b, y24, "F");
  doc.triangle(x548, y24b, x397, y108, x246, y24c, "F");
  doc.triangle(x0b, y24d, x246, y24c, x397, y108, "F");
}

async function loadPhotoDataUrl(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function drawProfessionalHeader(doc, { name, contact, setFill, setText, setDraw, photoDataUrl }) {
  drawProfessionalHeaderShape(doc, setFill);

  const cx = PRO_CV_PAGE.widthPt / 2;
  const photoY = PRO_CV_LAYOUT.photoCenterY;
  const photoR = PRO_CV_LAYOUT.photoRadiusPt;
  const resolvedPhoto = photoDataUrl || (await loadPhotoDataUrl(getContactPhotoUrl(contact)));

  setFill(doc, PRO_CV_COLORS.photoRing);
  doc.circle(cx, photoY, photoR + 5, "F");

  if (resolvedPhoto) {
    const size = photoR * 2;
    const format = String(resolvedPhoto).includes("image/png") ? "PNG" : "JPEG";
    doc.addImage(resolvedPhoto, format, cx - photoR, photoY - photoR, size, size, undefined, "FAST");
    setDraw(doc, PRO_CV_COLORS.photoRing);
    doc.setLineWidth(2.5);
    doc.circle(cx, photoY, photoR + 2.5, "S");
  } else {
    setFill(doc, PRO_CV_COLORS.photoBg);
    doc.circle(cx, photoY, photoR, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    setText(doc, "#4B5563");
    doc.text(contactInitials(name), cx, photoY + 6, { align: "center" });
  }

  const nameY = 132;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(27);
  setText(doc, PRO_CV_COLORS.text);
  doc.text(name, PRO_CV_LAYOUT.marginX, nameY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  setText(doc, PRO_CV_COLORS.muted);
  const headerLines = [contact.email, contact.phone, contact.location].filter(Boolean);
  let headerContactY = nameY - Math.max(0, headerLines.length - 1) * 5;
  headerLines.forEach((line) => {
    doc.text(String(line), PRO_CV_PAGE.widthPt - PRO_CV_LAYOUT.marginX, headerContactY, { align: "right" });
    headerContactY += 12;
  });

  return PRO_CV_LAYOUT.contentStartPt;
}

export async function renderProfessionalCV(doc, { contact = {}, resume = {}, job }, helpers) {
  const { setFill, setText, setDraw, writeWrapped } = helpers;
  const name = (contact.name || "Your Name").trim();
  const accent = PRO_CV_COLORS.accent;
  const { leftX, leftW, rightX, rightW, dividerX } = getColumnPositions();
  const pageBottom = PRO_CV_PAGE.heightPt - 24;

  const vScale = computeVerticalFillScale(
    estimateProfessionalContentHeight({ contact, resume }),
    { contentStart: PRO_CV_LAYOUT.contentStartPt, pageHeight: PRO_CV_PAGE.heightPt },
  );

  const gap = (value) => value * vScale;
  const lineH = (value) => value * vScale;
  const bodySize = Math.min(11.5, 10.2 * Math.sqrt(vScale));
  const titleSize = Math.min(12.5, 11 * Math.sqrt(vScale));
  const sectionLabelSize = Math.min(11, 9.5 * Math.sqrt(vScale));

  const contentStart = await drawProfessionalHeader(doc, { name, contact, setFill, setText, setDraw });

  setDraw(doc, PRO_CV_COLORS.line);
  doc.setLineWidth(0.6);
  doc.line(dividerX, contentStart - 4, dividerX, pageBottom);

  let leftY = contentStart;
  let rightY = contentStart;

  const drawSectionHeader = (label, x, y, width) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(sectionLabelSize);
    setText(doc, accent);
    doc.text(label.toUpperCase(), x, y);
    setDraw(doc, accent);
    doc.setLineWidth(1);
    doc.line(x, y + 4, x + width, y + 4);
    return y + gap(18);
  };

  const drawSquareBullet = (x, y) => {
    setFill(doc, accent);
    doc.rect(x, y - 4, 5, 5, "F");
  };

  leftY = drawSectionHeader("Contact", leftX, leftY, leftW);
  [
    ["Address", contact.location],
    ["Phone number", contact.phone],
    ["Email address", contact.email],
  ].filter(([, value]) => value).forEach(([label, value]) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    setText(doc, accent);
    doc.text(label.toUpperCase(), leftX, leftY);
    leftY += gap(11);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(bodySize);
    setText(doc, PRO_CV_COLORS.text);
    leftY = writeWrapped(doc, String(value), leftX, leftY, leftW, lineH(13), pageBottom);
    leftY += gap(8);
  });

  const socialLinks = [];
  if (contact.linkedin) socialLinks.push(contact.linkedin);
  if (contact.website) socialLinks.push(contact.website);
  if (socialLinks.length) {
    leftY += gap(6);
    leftY = drawSectionHeader("Social links", leftX, leftY, leftW);
    socialLinks.forEach((link) => {
      drawSquareBullet(leftX, leftY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(bodySize);
      setText(doc, PRO_CV_COLORS.text);
      leftY = writeWrapped(doc, link, leftX + 12, leftY, leftW - 12, lineH(13), pageBottom);
      leftY += gap(4);
    });
  }

  if (resume.skills?.length) {
    leftY += gap(6);
    leftY = drawSectionHeader("Skills", leftX, leftY, leftW);
    resume.skills.forEach((skill) => {
      drawSquareBullet(leftX, leftY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(bodySize);
      setText(doc, PRO_CV_COLORS.text);
      leftY = writeWrapped(doc, String(skill), leftX + 12, leftY, leftW - 12, lineH(13), pageBottom);
      leftY += gap(3);
    });
  }

  if (resume.languages?.length) {
    leftY += gap(6);
    leftY = drawSectionHeader("Languages", leftX, leftY, leftW);
    resume.languages.forEach((entry) => {
      const parts = String(entry).split(/\s[-–—]\s/);
      const langName = parts[0] || entry;
      const level = parts.slice(1).join(" - ");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(bodySize);
      setText(doc, PRO_CV_COLORS.text);
      doc.text(langName, leftX, leftY);
      if (level) {
        setText(doc, PRO_CV_COLORS.muted);
        doc.text(level, leftX + leftW, leftY, { align: "right" });
      }
      leftY += lineH(14);
    });
  }

  const rightSection = (title) => {
    rightY += gap(6);
    rightY = drawSectionHeader(title, rightX, rightY, rightW);
  };

  if (resume.summary) {
    rightSection("Profile");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(bodySize);
    setText(doc, PRO_CV_COLORS.text);
    rightY = writeWrapped(doc, resume.summary, rightX, rightY, rightW, lineH(14), pageBottom);
    rightY += gap(6);
  }

  if (resume.education?.length) {
    rightSection("Education");
    resume.education.forEach((entry) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(titleSize);
      setText(doc, PRO_CV_COLORS.text);
      doc.text(entry.degree || "", rightX, rightY);
      doc.setFont("helvetica", "normal");
      setText(doc, PRO_CV_COLORS.muted);
      doc.text(entry.year || "", rightX + rightW, rightY, { align: "right" });
      rightY += lineH(14);
      doc.setFontSize(bodySize);
      doc.text(entry.school || "", rightX, rightY);
      rightY += lineH(16);
    });
  }

  if (resume.experience?.length) {
    rightSection("Employment history");
    resume.experience.forEach((entry) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(titleSize);
      setText(doc, PRO_CV_COLORS.text);
      doc.text(entry.role || "", rightX, rightY);
      doc.setFont("helvetica", "normal");
      setText(doc, PRO_CV_COLORS.muted);
      doc.text(entry.duration || "", rightX + rightW, rightY, { align: "right" });
      rightY += lineH(14);
      doc.setFontSize(bodySize);
      doc.text([entry.company, entry.location].filter(Boolean).join(" · "), rightX, rightY);
      rightY += lineH(14);
      setText(doc, PRO_CV_COLORS.text);
      (entry.highlights || []).forEach((highlight) => {
        doc.text("•", rightX, rightY);
        rightY = writeWrapped(doc, highlight, rightX + 10, rightY, rightW - 10, lineH(13), pageBottom);
        rightY += gap(3);
      });
      rightY += gap(6);
    });
  }

  if (resume.highlights?.length) {
    rightSection("Extracurricular");
    resume.highlights.forEach((item) => {
      doc.text("•", rightX, rightY);
      rightY = writeWrapped(doc, item, rightX + 10, rightY, rightW - 10, lineH(13), pageBottom);
      rightY += gap(3);
    });
  }

  if (job?.title) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    setText(doc, PRO_CV_COLORS.muted);
    const footer = `Tailored for ${job.title} @ ${job.company}`;
    doc.text(footer, PRO_CV_PAGE.widthPt / 2, PRO_CV_PAGE.heightPt - 14, { align: "center" });
  }
}
