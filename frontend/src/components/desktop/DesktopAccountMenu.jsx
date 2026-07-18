import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BadgeCheck, ChevronDown, CreditCard, Eye, EyeOff, Gift, LogOut, User } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useAppLocale } from "../../context/AppLocaleContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { DemoAccountAvatarIndicator } from "../settings/DemoAccountBadge";
import { readAccountEmailBlurred, saveAccountEmailBlurred } from "../../lib/accountEmailPrivacy";

function AccountAvatar({ className = "" }) {
  return (
    <div className={`relative shrink-0 ${className}`}>
      <div
        className="grid size-8 place-items-center rounded-md border border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
        aria-hidden
      >
        <User className="size-4" strokeWidth={1.75} />
      </div>
      <DemoAccountAvatarIndicator />
    </div>
  );
}

function AccountEmailLabel({ email, blurred, className = "" }) {
  return (
    <span
      className={`min-w-0 flex-1 truncate font-medium transition-[filter] duration-200 ${blurred ? "select-none blur-[5px]" : ""} ${className}`}
      aria-hidden={blurred || undefined}
      title={blurred ? undefined : email}
    >
      {email}
    </span>
  );
}

export default function DesktopAccountMenu({ triggerClassName = "" }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { t } = useAppLocale();
  const email = user?.email || t("common.account");
  const [emailBlurred, setEmailBlurred] = useState(readAccountEmailBlurred);

  const toggleEmailBlur = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setEmailBlurred((current) => {
      const next = !current;
      saveAccountEmailBlurred(next);
      return next;
    });
  };

  const signOut = () => {
    logout();
  };

  return (
    <div className="flex w-full items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={triggerClassName}
            data-testid="desktop-account-menu-trigger"
          >
            <AccountAvatar />
            <AccountEmailLabel email={email} blurred={emailBlurred} />
            <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-zinc-400" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="bottom"
          sideOffset={6}
          className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[220px] overflow-hidden rounded-xl border border-zinc-200 bg-white p-0 shadow-lg"
          data-testid="desktop-account-menu"
        >
          <div className="flex items-center gap-3 px-3 py-3">
            <AccountAvatar />
            <AccountEmailLabel email={email} blurred={emailBlurred} className="text-sm text-zinc-900" />
          </div>

          <DropdownMenuSeparator className="my-0 bg-zinc-200" />

          <div className="p-1">
            <DropdownMenuItem
              className="cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-900 focus:bg-zinc-100"
              onClick={() => navigate("/profile")}
              data-testid="desktop-account-menu-profile"
            >
              <BadgeCheck className="size-4 text-zinc-700" />
              {t("accountMenu.account")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-900 focus:bg-zinc-100"
              onClick={() => navigate("/billing")}
              data-testid="desktop-account-menu-billing"
            >
              <CreditCard className="size-4 text-zinc-700" />
              {t("accountMenu.billing")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-900 focus:bg-zinc-100"
              onClick={() => navigate("/referral")}
              data-testid="desktop-account-menu-referral"
            >
              <Gift className="size-4 text-zinc-700" />
              {t("accountMenu.referral")}
            </DropdownMenuItem>
          </div>

          <DropdownMenuSeparator className="my-0 bg-zinc-200" />

          <div className="p-1">
            <DropdownMenuItem
              className="cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-900 focus:bg-zinc-100"
              onClick={signOut}
              data-testid="desktop-account-menu-logout"
            >
              <LogOut className="size-4 text-zinc-700" />
              {t("accountMenu.logOut")}
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        onClick={toggleEmailBlur}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        aria-label={emailBlurred ? t("accountMenu.showEmail") : t("accountMenu.blurEmail")}
        aria-pressed={emailBlurred}
        title={emailBlurred ? t("accountMenu.showEmail") : t("accountMenu.blurEmail")}
        data-testid="desktop-account-email-blur-toggle"
      >
        {emailBlurred ? <EyeOff className="h-4 w-4" strokeWidth={1.75} /> : <Eye className="h-4 w-4" strokeWidth={1.75} />}
      </button>
    </div>
  );
}
