import { useNavigate } from "react-router-dom";
import { BadgeCheck, ChevronDown, CreditCard, Gift, LogOut, User } from "lucide-react";
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

export default function DesktopAccountMenu({ triggerClassName = "" }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { t } = useAppLocale();
  const email = user?.email || t("common.account");

  const signOut = () => {
    logout();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={triggerClassName}
          data-testid="desktop-account-menu-trigger"
        >
          <AccountAvatar />
          <span className="min-w-0 flex-1 truncate font-medium">{email}</span>
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
          <span className="min-w-0 truncate text-sm font-medium text-zinc-900">{email}</span>
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
  );
}
