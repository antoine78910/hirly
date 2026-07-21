/** Shared CV upload formats — mobile cameras often send JPEG/HEIC without a clear extension. */

export const CV_ACCEPTED_EXTENSIONS = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".heic",
  ".heif",
  ".webp",
  ".docx",
  ".rtf",
  ".txt",
];

export const CV_ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/heic",
  "image/heif",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/rtf",
  "text/rtf",
  "text/plain",
];

export const CV_ACCEPT_ATTR = ".pdf,.png,.jpg,.jpeg,.heic,.webp,.docx,.rtf,.txt,image/*,application/pdf";

/** Max upload size shared by the CV, additional documents, and cover-letter uploads (matches backend). */
export const CV_MAX_BYTES = 20 * 1024 * 1024;
export const CV_MAX_MB = 20;

const MIME_TO_EXT = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/heic": ".heic",
  "image/heif": ".heic",
  "image/webp": ".webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/rtf": ".rtf",
  "text/rtf": ".rtf",
  "text/plain": ".txt",
};

/** Legacy Word 97-2003 binary format — detected so we can show a clear, actionable error
 * instead of a generic "unsupported file" message. */
export function isLegacyDocFile(file) {
  if (!file) return false;
  const name = (file.name || "").toLowerCase();
  return name.endsWith(".doc") || (file.type || "").toLowerCase() === "application/msword";
}

export function isAcceptedCvFile(file) {
  if (!file) return false;
  const name = (file.name || "").toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  if (CV_ACCEPTED_EXTENSIONS.includes(ext)) return true;
  return CV_ACCEPTED_MIME_TYPES.includes((file.type || "").toLowerCase());
}

/** Ensure mobile uploads carry an extension the backend can detect (e.g. blob → cv.jpg). */
export function normalizeCvUploadFile(file) {
  if (!file) return file;
  const name = file.name || "";
  if (/\.\w{2,5}$/i.test(name)) return file;
  const ext = MIME_TO_EXT[(file.type || "").toLowerCase()] || ".pdf";
  const base = name && name !== "blob" ? name.replace(/[^\w.-]+/g, "_") : "cv";
  return new File([file], `${base}${ext}`, {
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified,
  });
}
