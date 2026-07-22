import {
  PRO_CV_COLORS_PHOTO,
  PRO_CV_COLORS_PLAIN,
  PRO_CV_LAYOUT_PHOTO,
  PRO_CV_LAYOUT_PLAIN,
  PRO_CV_PAGE,
  computeVerticalFillScale,
  estimateProfessionalContentHeight,
  getColumnPositions,
  getContactPhotoUrl,
  resolveProfessionalVariant,
} from "./cvTemplate";

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

function drawPhotoHeaderShape(doc, setFill, colors) {
  const cx = PRO_CV_PAGE.widthPt / 2;
  const scale = PRO_CV_PAGE.widthPt / 794;
  const left = cx - 135 * scale;
  const right = cx + 135 * scale;
  const dipY = 96 * (PRO_CV_LAYOUT_PHOTO.headerHeightPt / 120);

  setFill(doc, colors.accent);
  doc.triangle(left, 0, right, 0, cx, dipY, "F");
}

async function drawPhotoHeader(doc, { name, contact, setFill, setText, setDraw, photoDataUrl }) {
  const colors = PRO_CV_COLORS_PHOTO;
  const cx = PRO_CV_PAGE.widthPt / 2;
  const photoY = PRO_CV_LAYOUT_PHOTO.photoCenterY;
  const photoR = PRO_CV_LAYOUT_PHOTO.photoRadiusPt;
  const resolvedPhoto = photoDataUrl || (await loadPhotoDataUrl(getContactPhotoUrl(contact)));

  drawPhotoHeaderShape(doc, setFill, colors);

  if (resolvedPhoto) {
    setFill(doc, colors.photoRing);
    doc.circle(cx, photoY, photoR + 4, "F");
    const size = photoR * 2;
    const format = String(resolvedPhoto).includes("image/png") ? "PNG" : "JPEG";
    doc.addImage(
      resolvedPhoto,
      format,
      cx - photoR,
      photoY - photoR,
      size,
      size,
      undefined,
      "FAST",
    );
    setDraw(doc, colors.photoRing);
    doc.setLineWidth(2);
    doc.circle(cx, photoY, photoR + 2, "S");
  }

  const nameY = PRO_CV_LAYOUT_PHOTO.nameRowY;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(21);
  setText(doc, colors.text);
  doc.text(name, PRO_CV_LAYOUT_PHOTO.marginX, nameY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  setText(doc, colors.muted);
  const headerLines = [contact.email, contact.phone, contact.location].filter(Boolean);
  let contactY = nameY - 2;
  headerLines.forEach((line) => {
    doc.text(String(line), PRO_CV_PAGE.widthPt - PRO_CV_LAYOUT_PHOTO.marginX, contactY, {
      align: "right",
    });
    contactY += 13;
  });

  return PRO_CV_LAYOUT_PHOTO.contentStartPt;
}

function drawPlainHeader(doc, { name, contact, setFill, setText, setDraw }) {
  const colors = PRO_CV_COLORS_PLAIN;
  const marginX = PRO_CV_LAYOUT_PLAIN.marginX;
  const pageW = PRO_CV_PAGE.widthPt;

  let y = 52;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(23);
  setText(doc, colors.text);
  doc.text(name, marginX, y);

  y += 22;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  setText(doc, colors.muted);
  const contactLine = [contact.email, contact.phone, contact.location]
    .filter(Boolean)
    .join("   ·   ");
  if (contactLine) {
    doc.text(contactLine, marginX, y);
    y += 18;
  }

  setDraw(doc, colors.line);
  doc.setLineWidth(0.75);
  doc.line(marginX, y, pageW - marginX, y);

  return PRO_CV_LAYOUT_PLAIN.contentStartPt;
}

function renderColumns(doc, { contact, resume, colors, layout, contentStart, helpers }) {
  const { setFill, setText, setDraw, writeWrapped } = helpers;
  const accent = colors.accent;
  const { leftX, leftW, rightX, rightW, dividerX } = getColumnPositions(
    PRO_CV_PAGE.widthPt,
    layout,
  );
  const pageBottom = PRO_CV_PAGE.heightPt - 36;

  const vScale = computeVerticalFillScale(
    estimateProfessionalContentHeight({ contact, resume }, { contentStartPt: 0 }),
    { contentStart, pageHeight: PRO_CV_PAGE.heightPt },
  );

  const gap = (value) => value * vScale;
  const lineH = (value) => value * vScale;

  setDraw(doc, colors.line);
  doc.setLineWidth(0.5);
  doc.line(dividerX, contentStart - 6, dividerX, pageBottom);

  let leftY = contentStart;
  let rightY = contentStart;

  const drawSectionHeader = (label, x, y, width) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    setText(doc, accent);
    doc.text(label.toUpperCase(), x, y);
    setDraw(doc, accent);
    doc.setLineWidth(0.75);
    doc.line(x, y + 5, x + width, y + 5);
    return y + gap(22);
  };

  const drawSquareBullet = (x, y) => {
    setFill(doc, accent);
    doc.rect(x, y - 3.5, 3.5, 3.5, "F");
  };

  leftY = drawSectionHeader("Contact", leftX, leftY, leftW);
  [
    ["Address", contact.location],
    ["Phone", contact.phone],
    ["Email", contact.email],
  ]
    .filter(([, value]) => value)
    .forEach(([label, value]) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      setText(doc, accent);
      doc.text(label.toUpperCase(), leftX, leftY);
      leftY += gap(12);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      setText(doc, colors.text);
      leftY = writeWrapped(doc, String(value), leftX, leftY, leftW, lineH(13), pageBottom);
      leftY += gap(10);
    });

  const socialLinks = [];
  if (contact.linkedin) socialLinks.push(contact.linkedin);
  if (contact.website) socialLinks.push(contact.website);
  if (socialLinks.length) {
    leftY += gap(4);
    leftY = drawSectionHeader("Social links", leftX, leftY, leftW);
    socialLinks.forEach((link) => {
      drawSquareBullet(leftX, leftY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      setText(doc, colors.text);
      leftY = writeWrapped(doc, link, leftX + 10, leftY, leftW - 10, lineH(13), pageBottom);
      leftY += gap(5);
    });
  }

  if (resume.skills?.length) {
    leftY += gap(4);
    leftY = drawSectionHeader("Skills", leftX, leftY, leftW);
    resume.skills.forEach((skill) => {
      drawSquareBullet(leftX, leftY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      setText(doc, colors.text);
      leftY = writeWrapped(
        doc,
        String(skill),
        leftX + 10,
        leftY,
        leftW - 10,
        lineH(13),
        pageBottom,
      );
      leftY += gap(4);
    });
  }

  if (resume.languages?.length) {
    leftY += gap(4);
    leftY = drawSectionHeader("Languages", leftX, leftY, leftW);
    resume.languages.forEach((entry) => {
      const parts = String(entry).split(/\s[-–—]\s/);
      const langName = parts[0] || entry;
      const level = parts.slice(1).join(" - ");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      setText(doc, colors.text);
      doc.text(langName, leftX, leftY);
      if (level) {
        setText(doc, colors.muted);
        doc.text(level, leftX + leftW, leftY, { align: "right" });
      }
      leftY += lineH(15);
    });
  }

  const rightSection = (title) => {
    rightY += gap(4);
    rightY = drawSectionHeader(title, rightX, rightY, rightW);
  };

  if (resume.summary) {
    rightSection("Profile");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    setText(doc, colors.text);
    rightY = writeWrapped(doc, resume.summary, rightX, rightY, rightW, lineH(14), pageBottom);
    rightY += gap(8);
  }

  if (resume.education?.length) {
    rightSection("Education");
    resume.education.forEach((entry) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      setText(doc, colors.text);
      doc.text(entry.degree || "", rightX, rightY);
      doc.setFont("helvetica", "normal");
      setText(doc, colors.muted);
      doc.text(entry.year || "", rightX + rightW, rightY, { align: "right" });
      rightY += lineH(14);
      doc.setFontSize(9.5);
      doc.text(entry.school || "", rightX, rightY);
      rightY += lineH(18);
    });
  }

  if (resume.experience?.length) {
    rightSection("Employment history");
    resume.experience.forEach((entry) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      setText(doc, colors.text);
      doc.text(entry.role || "", rightX, rightY);
      doc.setFont("helvetica", "normal");
      setText(doc, colors.muted);
      doc.text(entry.duration || "", rightX + rightW, rightY, { align: "right" });
      rightY += lineH(14);
      doc.setFontSize(9.5);
      doc.text([entry.company, entry.location].filter(Boolean).join(" · "), rightX, rightY);
      rightY += lineH(14);
      setText(doc, colors.text);
      (entry.highlights || []).forEach((highlight) => {
        doc.text("•", rightX, rightY);
        rightY = writeWrapped(
          doc,
          highlight,
          rightX + 10,
          rightY,
          rightW - 10,
          lineH(13),
          pageBottom,
        );
        rightY += gap(4);
      });
      rightY += gap(8);
    });
  }

  if (resume.highlights?.length) {
    rightSection("Extracurricular");
    resume.highlights.forEach((item) => {
      doc.text("•", rightX, rightY);
      rightY = writeWrapped(doc, item, rightX + 10, rightY, rightW - 10, lineH(13), pageBottom);
      rightY += gap(4);
    });
  }
}

export async function renderProfessionalCV(doc, { contact = {}, resume = {} }, helpers) {
  const name = (contact.name || "Your Name").trim();
  const variant = resolveProfessionalVariant(contact);

  if (variant === "photo") {
    const contentStart = await drawPhotoHeader(doc, { name, contact, ...helpers });
    renderColumns(doc, {
      contact,
      resume,
      colors: PRO_CV_COLORS_PHOTO,
      layout: PRO_CV_LAYOUT_PHOTO,
      contentStart,
      helpers,
    });
    return;
  }

  const contentStart = drawPlainHeader(doc, { name, contact, ...helpers });
  renderColumns(doc, {
    contact,
    resume,
    colors: PRO_CV_COLORS_PLAIN,
    layout: PRO_CV_LAYOUT_PLAIN,
    contentStart,
    helpers,
  });
}
