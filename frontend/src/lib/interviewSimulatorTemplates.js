import { api, getDirectApiBase } from "./api";

export async function fetchInterviewTemplates() {
  const { data } = await api.get("/record-tools/interview-templates");
  return data?.templates || [];
}

export async function fetchInterviewTemplate(templateId) {
  const { data } = await api.get(`/record-tools/interview-templates/${templateId}`);
  return data;
}

export async function saveInterviewTemplate({
  name,
  segments,
  splitSettings,
  durationSeconds,
  audioFile,
}) {
  const form = new FormData();
  form.append("name", name);
  form.append("segments", JSON.stringify(segments));
  form.append("split_settings", JSON.stringify(splitSettings || {}));
  if (durationSeconds != null) {
    form.append("duration_seconds", String(durationSeconds));
  }
  form.append("audio", audioFile);

  // IMPORTANT: do not manually set `Content-Type` for multipart/form-data.
  // Let the browser/axios add the correct boundary, otherwise the backend/proxy can hang.
  const base = (getDirectApiBase() || "").replace(/\/+$/, "");
  const url = `${base}/record-tools/interview-templates`;

  const { data } = await api.post(url, form, {
    // Give the backend plenty of time to receive and store the file.
    timeout: 240000,
  });
  return data;
}

export async function fetchInterviewTemplateAudioBlob(templateId) {
  const { data } = await api.get(`/record-tools/interview-templates/${templateId}/audio`, {
    responseType: "blob",
    timeout: 120000,
  });
  return data;
}
