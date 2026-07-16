import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Gift, Clock3, X, Loader2 } from "lucide-react";
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from "../../lib/notifications";
import { formatTimelineDate } from "../../lib/applicationTimeline";
import { useAppLocale } from "../../context/AppLocaleContext";

const TYPE_ICON = {
  credits_granted: Gift,
  offer_expired: Clock3,
};

function NotificationRow({ notification, lang, onClick }) {
  const Icon = TYPE_ICON[notification.type] || Bell;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
        notification.read ? "opacity-70 hover:bg-white/5" : "bg-violet-500/10 hover:bg-violet-500/15"
      }`}
      data-testid={`notification-row-${notification.notification_id}`}
    >
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-500/20 text-violet-300">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-white">{notification.title}</span>
          {!notification.read ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" /> : null}
        </span>
        <span className="mt-0.5 block text-xs text-zinc-400">{notification.body}</span>
        <span className="mt-1 block text-[11px] text-zinc-500">{formatTimelineDate(notification.created_at, lang)}</span>
      </span>
    </button>
  );
}

function NotificationsList({ notifications, loading, lang, t, onItemClick, onMarkAllRead }) {
  const hasUnread = notifications.some((n) => !n.read);
  return (
    <div className="flex h-full flex-col">
      {hasUnread ? (
        <div className="flex items-center justify-end pb-2">
          <button
            type="button"
            onClick={onMarkAllRead}
            className="text-xs font-semibold text-violet-300 hover:text-violet-200"
            data-testid="notifications-mark-all-read"
          >
            {t("notifications.markAllRead")}
          </button>
        </div>
      ) : null}
      <div className="flex-1 space-y-1.5 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
          </div>
        ) : notifications.length ? (
          notifications.map((n) => (
            <NotificationRow key={n.notification_id} notification={n} lang={lang} onClick={() => onItemClick(n)} />
          ))
        ) : (
          <div className="py-10 text-center text-sm text-zinc-500">{t("notifications.empty")}</div>
        )}
      </div>
    </div>
  );
}

/**
 * Real notification feed (credits granted, offer expired). Fetches once on
 * mount so the bell badge is correct even before the panel is opened; no
 * polling per product scope (fetch-on-load only).
 */
export default function NotificationsPanel({ open, onClose, variant = "sheet", onUnreadCountChange }) {
  const { t, lang } = useAppLocale();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchNotifications()
      .then((data) => {
        if (cancelled) return;
        setNotifications(data.notifications || []);
        onUnreadCountChange?.(data.unread_count || 0);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleItemClick = async (notification) => {
    if (notification.read) return;
    setNotifications((prev) =>
      prev.map((n) => (n.notification_id === notification.notification_id ? { ...n, read: true } : n)),
    );
    onUnreadCountChange?.((count) => Math.max(0, (count || 0) - 1));
    try {
      await markNotificationRead(notification.notification_id);
    } catch {
      /* best-effort */
    }
  };

  const handleMarkAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    onUnreadCountChange?.(0);
    try {
      await markAllNotificationsRead();
    } catch {
      /* best-effort */
    }
  };

  if (variant === "dropdown") {
    if (!open) return null;
    return (
      <>
        <div className="fixed inset-0 z-[75]" onClick={onClose} />
        <div
          className="absolute right-0 top-full z-[76] mt-2 max-h-[26rem] w-80 rounded-2xl border border-zinc-800 bg-zinc-950 p-3 shadow-2xl"
          data-testid="notifications-dropdown"
        >
          <NotificationsList
            notifications={notifications}
            loading={loading}
            lang={lang}
            t={t}
            onItemClick={handleItemClick}
            onMarkAllRead={handleMarkAllRead}
          />
        </div>
      </>
    );
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[79] bg-black/50"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="fixed inset-x-0 bottom-0 z-[80] flex max-h-[75vh] flex-col rounded-t-3xl border-t border-zinc-800 bg-zinc-950 px-4 pb-6 pt-4 text-white"
            data-testid="notifications-sheet"
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-bold">{t("notifications.title")}</h2>
              <button
                type="button"
                onClick={onClose}
                className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/5"
                aria-label={t("common.cancel")}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NotificationsList
              notifications={notifications}
              loading={loading}
              lang={lang}
              t={t}
              onItemClick={handleItemClick}
              onMarkAllRead={handleMarkAllRead}
            />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
