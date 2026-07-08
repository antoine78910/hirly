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
  const { data } = await api.post("/record-tools/interview-templates", form, {
    baseURL: getDirectApiBase(),
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 120000,
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
