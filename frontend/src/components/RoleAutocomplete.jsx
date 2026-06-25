import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Briefcase } from "lucide-react";
import { Input } from "./ui/input";
import { searchRoleSuggestions } from "../lib/roleSuggestions";
import { isFrench, translateRoleGroupLabel, translateRoleLabel } from "../lib/localizedDisplay";

export default function RoleAutocomplete({
  value,
  onInputChange,
  onPick,
  placeholder = "Job title",
  variant = "light",
  relatedRole = "",
  testId = "role-autocomplete",
  onFieldFocus,
  onFieldBlur,
  disabled = false,
  lang = "en",
}) {
  const light = variant === "light";
  const [focused, setFocused] = useState(false);
  const blurTimerRef = useRef(null);
  const anchorRef = useRef(null);
  const [dropdownRect, setDropdownRect] = useState(null);

  const trimmedValue = (value || "").trim();
  const suggestions = useMemo(
    () => searchRoleSuggestions(trimmedValue, { limit: 8, relatedRole, lang }),
    [lang, relatedRole, trimmedValue],
  );
  const visibleSuggestions = useMemo(() => {
    return suggestions;
  }, [suggestions]);

  const showDropdown = focused && visibleSuggestions.length > 0;

  const inputClass = `h-auto min-h-0 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 ${
    light ? "text-zinc-900 placeholder:text-zinc-400" : "text-white placeholder:text-sprout-dim"
  }`;

  const dropdownClass = light
    ? "scrollbar-thin rounded-2xl border border-zinc-200 bg-white shadow-xl overflow-hidden max-h-60 overflow-y-auto"
    : "scrollbar-thin rounded-2xl border border-sprout-border bg-sprout-surface shadow-xl overflow-hidden max-h-60 overflow-y-auto";
  const optionClass = light
    ? "w-full text-left px-4 py-2.5 text-sm text-zinc-700 hover:bg-zinc-50 flex items-start gap-2.5"
    : "w-full text-left px-4 py-2.5 text-sm text-white hover:bg-sprout-mint-soft flex items-start gap-2.5";
  const headerClass = light
    ? "px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400"
    : "px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-sprout-muted";
  const badgeClass = light ? "text-xs text-zinc-400" : "text-xs text-zinc-500";

  const updateDropdownRect = useCallback(() => {
    const node = anchorRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setDropdownRect({
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 260),
    });
  }, []);

  useLayoutEffect(() => {
    if (!showDropdown) {
      setDropdownRect(null);
      return undefined;
    }
    updateDropdownRect();
    window.addEventListener("resize", updateDropdownRect);
    window.addEventListener("scroll", updateDropdownRect, true);
    return () => {
      window.removeEventListener("resize", updateDropdownRect);
      window.removeEventListener("scroll", updateDropdownRect, true);
    };
  }, [showDropdown, trimmedValue, updateDropdownRect]);

  const handleFocus = () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    setFocused(true);
    onFieldFocus?.();
  };

  const handleBlur = () => {
    blurTimerRef.current = setTimeout(() => {
      setFocused(false);
      onFieldBlur?.();
    }, 150);
  };

  const pickRole = (role) => {
    onInputChange(role);
    onPick?.(role);
    setFocused(false);
  };

  const dropdownTitle = isFrench(lang)
    ? (trimmedValue ? "Métiers correspondants" : "Métiers suggérés")
    : (trimmedValue ? "Matching roles" : "Suggested roles");

  return (
    <div className="min-w-0 flex-1" data-testid={testId}>
      <div className="relative" ref={anchorRef}>
        <Input
          value={value || ""}
          onChange={(e) => onInputChange(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder={placeholder}
          className={inputClass}
          data-testid={`${testId}-input`}
          autoComplete="off"
          disabled={disabled}
        />

        {showDropdown && dropdownRect && typeof document !== "undefined"
          ? createPortal(
              <div
                className={dropdownClass}
                role="listbox"
                style={{
                  position: "fixed",
                  top: dropdownRect.top,
                  left: dropdownRect.left,
                  width: dropdownRect.width,
                  zIndex: 9999,
                }}
              >
                <p className={headerClass}>{dropdownTitle}</p>
                {visibleSuggestions.map(({ role, group }) => (
                  <button
                    key={role}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickRole(role)}
                    className={optionClass}
                    data-testid={`${testId}-option`}
                    role="option"
                  >
                    <Briefcase className={`mt-0.5 h-4 w-4 shrink-0 ${light ? "text-violet-500" : "text-sprout-mint"}`} />
                    <span className="min-w-0">
                      <span className="block">{translateRoleLabel(role, lang)}</span>
                      <span className={`block mt-0.5 ${badgeClass}`}>{translateRoleGroupLabel(group, lang)}</span>
                    </span>
                  </button>
                ))}
              </div>,
              document.body,
            )
          : null}
      </div>
    </div>
  );
}
