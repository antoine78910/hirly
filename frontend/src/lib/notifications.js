import { api } from "./api";

/** Thin wrapper around the real notifications endpoints (credits granted, offer expired). */
export async function fetchNotifications() {
  const { data } = await api.get("/notifications");
  return data;
}

export async function markNotificationRead(notificationId) {
  const { data } = await api.post(`/notifications/${notificationId}/read`);
  return data;
}

export async function markAllNotificationsRead() {
  const { data } = await api.post("/notifications/read-all");
  return data;
}
