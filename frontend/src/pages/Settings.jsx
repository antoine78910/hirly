import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import {
  ArrowLeft, Palette, Bell,
  CreditCard, MessageSquare, Users, Instagram, LogOut, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import Logo from "../components/Logo";
import { BRAND } from "../lib/brand";
import { AppPage, AppPageScroll } from "../components/app/AppPageShell";
import DesktopAppShell from "../components/desktop/DesktopAppShell";
import AISettingsPanel from "../components/desktop/AISettingsPanel";
import MobileAISettings from "../components/settings/MobileAISettings";
import ContactSupportDialog from "../components/settings/ContactSupportDialog";
import DeleteAccountDialog from "../components/settings/DeleteAccountDialog";
import ThemeSettingsSheet from "../components/settings/ThemeSettingsSheet";
import NotificationSettingsSheet from "../components/settings/NotificationSettingsSheet";
import { useMobileTheme } from "../context/MobileThemeContext";
import { mobileThemeLabel } from "../lib/mobileTheme";
import {
  countEnabledNotifications,
  readNotificationSettings,
} from "../lib/notificationSettings";
import { useAppLocale } from "../context/AppLocaleContext";

const Section = ({ label, children, testId }) => (
  <section className="mt-7" data-testid={testId}>
    <h2 className="text-xs uppercase tracking-[0.16em] text-sprout-muted px-1 mb-2">{label}</h2>
    <div className="rounded-2xl bg-sprout-surface border border-sprout-border divide-y divide-sprout-border overflow-hidden">
      {children}
    </div>
  </section>
);

const Row = ({ icon: Icon, label, value, onClick, danger, testId }) => (
  <button
    onClick={onClick}
    data-testid={testId}
    className="w-full h-14 px-4 flex items-center gap-3 hover:bg-sprout-surface-2 transition-colors text-left"
  >
    {Icon && <Icon className={`w-5 h-5 ${danger ? "text-rose-400" : "text-white"}`} strokeWidth={1.9} />}
    <span className={`flex-1 text-[15px] font-medium ${danger ? "text-rose-400" : "text-white"}`}>{label}</span>
    {value !== undefined && <span className="text-sm text-sprout-muted">{value}</span>}
    {!danger && <span className="text-sprout-muted text-xl leading-none">›</span>}
  </button>
);

const TikTok = (props) => (
  // Lucide doesn't ship a TikTok glyph — minimal inline SVG to keep us emoji-free.
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M19.32 6.69a5.43 5.43 0 0 1-3.18-1.04A5.5 5.5 0 0 1 14.13 2H10.7v12.96a2.6 2.6 0 1 1-2.6-2.6c.16 0 .31.02.46.05V9.04a6.04 6.04 0 1 0 5.57 6.02V8.55a8.92 8.92 0 0 0 5.19 1.66V6.69z"/>
  </svg>
);

export default function Settings() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const { t } = useAppLocale();
  const { theme } = useMobileTheme();
  const [billing, setBilling] = useState(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() =>
    countEnabledNotifications(readNotificationSettings()),
  );

  useEffect(() => {
    api.get("/billing/status").then(({ data }) => setBilling(data)).catch(() => setBilling(null));
  }, []);

  useEffect(() => {
    const syncNotifications = () => {
      setNotificationsEnabled(countEnabledNotifications(readNotificationSettings()));
    };
    syncNotifications();
    window.addEventListener("hirly:notification-settings-changed", syncNotifications);
    return () => window.removeEventListener("hirly:notification-settings-changed", syncNotifications);
  }, []);

  const inviteFriends = async () => {
    const url = `${window.location.origin}/?ref=${encodeURIComponent(user?.email || "")}`;
    if (navigator.share) {
      try { await navigator.share({ title: BRAND.NAME, text: `Apply to jobs in 1 second with ${BRAND.NAME}.`, url }); return; } catch (_) {}
    }
    try { await navigator.clipboard.writeText(url); toast.success(t("settings.inviteCopied")); }
    catch (_) { toast("Share: " + url); }
  };

  const openExternal = (href) => window.open(href, "_blank", "noopener");

  const openBilling = () => navigate("/billing");

  return (
    <>
      <div className="hidden md:block">
        <DesktopAppShell>
          <AISettingsPanel />
        </DesktopAppShell>
      </div>

      <AppPage className="sprout bg-sprout-bg text-white md:hidden">
      <header className="mx-auto w-full max-w-md shrink-0 px-5 pt-6 flex items-center gap-3" data-testid="settings-header">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 grid place-items-center rounded-full hover:bg-sprout-surface"
          data-testid="settings-back-btn"
          aria-label={t("common.back")}
        >
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>
        <h1 className="font-display font-bold text-2xl flex-1 text-center pr-10">{t("settings.title")}</h1>
      </header>

      <AppPageScroll className="mx-auto max-w-md px-5 pb-32" withBottomNavPad={false}>
      <Section label={t("settings.lookAndFeel")} testId="settings-appearance">
        <Row icon={Palette} label={t("settings.theme")} value={mobileThemeLabel(theme, t)} onClick={() => setThemeOpen(true)} testId="settings-theme" />
      </Section>

      <Section label={t("settings.notifications")} testId="settings-notifications">
        <Row
          icon={Bell}
          label={t("settings.notifications")}
          value={t("settings.notificationsEnabled", { n: notificationsEnabled })}
          onClick={() => setNotificationsOpen(true)}
          testId="settings-notif-prefs"
        />
      </Section>

      <MobileAISettings />

      <Section label={t("settings.planHelp")} testId="settings-support">
        <Row icon={CreditCard}    label={billing?.is_premium ? t("settings.manageBilling") : t("settings.upgradePlan")} onClick={openBilling} testId="settings-subscribe" />
        <Row icon={MessageSquare} label={t("settings.talkToUs")}        onClick={() => setContactOpen(true)} testId="settings-chat" />
      </Section>

      <Section label={t("settings.shareBrand", { brand: BRAND.NAME })} testId="settings-social">
        <Row icon={Users}     label={t("settings.inviteFriend")} onClick={inviteFriends}                                 testId="settings-invite" />
        <Row icon={Instagram} label={t("settings.onInstagram")} value={t("settings.socialHandle")} onClick={() => openExternal(BRAND.INSTAGRAM_URL)} testId="settings-instagram" />
        <Row icon={TikTok}    label={t("settings.onTikTok")}    value={t("settings.socialHandle")} onClick={() => openExternal(BRAND.TIKTOK_URL)}    testId="settings-tiktok" />
      </Section>

      <Section label={t("settings.yourAccount")} testId="settings-account">
        <Row icon={LogOut} label={t("settings.signOut")} onClick={() => logout()} testId="settings-logout" danger />
        <Row icon={Trash2} label={t("settings.deleteAccount")}  onClick={() => setDeleteOpen(true)} testId="settings-delete" danger />
      </Section>

      <footer className="mt-10 mb-4 flex flex-col items-center gap-2 text-center" data-testid="settings-footer">
        <Logo size={36} />
        <p className="font-display font-bold text-white">{BRAND.NAME}</p>
        <p className="text-xs text-sprout-muted">{t("settings.userId")}</p>
        <code className="text-[11px] text-sprout-dim break-all px-3" data-testid="settings-user-id">{user?.user_id || "—"}</code>
      </footer>
      </AppPageScroll>
      <ContactSupportDialog open={contactOpen} onClose={() => setContactOpen(false)} />
      <DeleteAccountDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} />
      <ThemeSettingsSheet open={themeOpen} onClose={() => setThemeOpen(false)} />
      <NotificationSettingsSheet open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
    </AppPage>
    </>
  );
}
