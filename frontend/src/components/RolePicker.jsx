import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { sel } from "../lib/selectionTheme";
import { ROLE_GROUPS, searchRoleSuggestions } from "../lib/roleSuggestions";
import { isFrench, translateRoleGroupLabel, translateRoleLabel } from "../lib/localizedDisplay";

export default function RolePicker({
  value,
  onChange,
  testId = "role-picker",
  variant = "dark",
  lang = "en",
  inline = false,
}) {
  const light = variant === "light";
  const labelClass = light
    ? "text-sm font-semibold text-zinc-700"
    : "text-sm font-semibold text-zinc-200";
  const triggerClass = light
    ? "w-full h-11 rounded-xl bg-white border border-zinc-200 text-zinc-900 px-4 flex items-center justify-between text-left"
    : "w-full h-11 rounded-xl bg-sprout-surface-2 border border-sprout-border text-white px-4 flex items-center justify-between text-left";
  const valueClass = light
    ? `truncate text-sm ${value ? "text-zinc-900" : "text-zinc-400"}`
    : `truncate text-sm ${value ? "text-white" : "text-sprout-dim"}`;
  const chevronClass = light ? "w-4 h-4 text-zinc-400" : "w-4 h-4 text-sprout-muted";
  const inputClass = light
    ? "h-11 rounded-xl bg-white border-zinc-200 text-zinc-900 placeholder:text-zinc-400 pl-10"
    : "h-11 rounded-xl bg-sprout-surface-2 border-sprout-border text-white placeholder:text-sprout-dim pl-10";
  const listClass = light
    ? "max-h-[42vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100"
    : "max-h-[42vh] overflow-y-auto rounded-2xl border border-sprout-border bg-sprout-surface divide-y divide-sprout-border";
  const emptyClass = light
    ? "px-4 py-5 text-sm text-zinc-500"
    : "px-4 py-5 text-sm text-sprout-muted";
  const groupTitleClass = light
    ? "px-4 pb-2 text-[11px] uppercase tracking-[0.16em] text-zinc-500"
    : "px-4 pb-2 text-[11px] uppercase tracking-[0.16em] text-sprout-muted";
  const roleOnClass = sel.listOn;
  const roleOffClass = light ? sel.listOff : `${sel.listOff} text-zinc-700`;
  const searchIconClass = light
    ? "w-4 h-4 text-zinc-400 absolute left-3 top-3.5"
    : "w-4 h-4 text-sprout-muted absolute left-3 top-3.5";

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(inline);
  const blurTimerRef = useRef(null);

  useEffect(() => {
    if (!open && !inline) return;
    setQuery((value || "").trim());
  }, [open, inline, value]);

  const filteredGroups = useMemo(() => {
    const q = query.trim();
    if (!q) return ROLE_GROUPS;
    const matchingRoles = new Set(
      searchRoleSuggestions(q, { limit: 200, lang }).map((entry) => entry.role),
    );
    return ROLE_GROUPS.map((group) => ({
      ...group,
      roles: group.roles.filter((role) => matchingRoles.has(role)),
    })).filter((group) => group.roles.length > 0);
  }, [lang, query]);

  const trimmedQuery = query.trim();
  const displayValue = (value || "").trim();
  const showCustomAction = trimmedQuery.length >= 1;
  const customActionLabel = isFrench(lang)
    ? `Rechercher « ${trimmedQuery} »`
    : `Search for "${trimmedQuery}"`;

  const commitRole = (roleText, { closePanel = true } = {}) => {
    const next = (roleText || "").trim();
    if (!next) return;
    setQuery(next);
    onChange(next);
    if (closePanel && !inline) setOpen(false);
  };

  const selectRole = (role) => {
    const label = translateRoleLabel(role, lang) || role;
    commitRole(label);
  };

  const handleSearchChange = (event) => {
    const next = event.target.value;
    setQuery(next);
    onChange(next.trim());
  };

  const handleBlur = () => {
    blurTimerRef.current = setTimeout(() => {
      if (!inline) setOpen(false);
      if (trimmedQuery) commitRole(trimmedQuery, { closePanel: false });
    }, 150);
  };

  const handleFocus = () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    if (!inline) setOpen(true);
  };

  const roleLabel = isFrench(lang) ? "Métier ciblé" : "Target role";
  const searchLabel = isFrench(lang) ? "Rechercher ou saisir un métier" : "Search or enter a role";
  const placeholder = isFrench(lang)
    ? "Ex. Coiffeur, Analyste crédit…"
    : "e.g. Hair stylist, Credit analyst…";
  const choosePlaceholder = isFrench(lang)
    ? "Choisir ou saisir un métier"
    : "Choose or enter a role";

  const suggestionsList = (
    <div className={listClass}>
      {showCustomAction ? (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => commitRole(trimmedQuery)}
          className={`w-full px-4 py-3 text-left text-sm font-semibold ${roleOnClass}`}
          data-testid={`${testId}-use-custom`}
        >
          {customActionLabel}
        </button>
      ) : null}

      {filteredGroups.length === 0 ? (
        showCustomAction ? null : (
          <div className={emptyClass}>
            {isFrench(lang)
              ? "Saisissez un métier — votre mot-clé sera utilisé pour la recherche."
              : "Type a job title — your keyword will be used for search."}
          </div>
        )
      ) : (
        filteredGroups.map((group) => (
          <section key={group.group} className="py-3">
            <h3 className={groupTitleClass}>{translateRoleGroupLabel(group.group, lang)}</h3>
            <div className="space-y-1">
              {group.roles.map((role) => (
                <button
                  key={role}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectRole(role)}
                  className={`w-full px-4 py-2.5 text-left text-sm font-medium transition-colors ${
                    displayValue === (translateRoleLabel(role, lang) || role)
                      ? roleOnClass
                      : roleOffClass
                  }`}
                  data-testid={`${testId}-role`}
                >
                  {translateRoleLabel(role, lang)}
                </button>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );

  if (inline) {
    return (
      <div className="space-y-2" data-testid={testId}>
        <Label className={labelClass}>{roleLabel}</Label>
        <div className="relative">
          <Search className={searchIconClass} />
          <Input
            value={query}
            onChange={handleSearchChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            placeholder={placeholder}
            className={inputClass}
            data-testid={`${testId}-search`}
            autoComplete="off"
          />
        </div>
        <p className={`text-xs ${light ? "text-zinc-500" : "text-sprout-muted"}`}>
          {isFrench(lang)
            ? "Toute saisie fonctionne, même si le métier n'est pas dans la liste."
            : "Any entry works, even if the role is not in the list."}
        </p>
        {trimmedQuery.length >= 1 ? suggestionsList : null}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid={testId}>
      <div className="space-y-1.5">
        <Label className={labelClass}>{roleLabel}</Label>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className={triggerClass}
          data-testid={`${testId}-toggle`}
        >
          <span className={valueClass}>{displayValue || choosePlaceholder}</span>
          <ChevronDown
            className={`${chevronClass} transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {open && (
        <>
          <div className="space-y-1.5">
            <Label className={labelClass}>{searchLabel}</Label>
            <div className="relative">
              <Search className={searchIconClass} />
              <Input
                value={query}
                onChange={handleSearchChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                placeholder={placeholder}
                className={inputClass}
                data-testid={`${testId}-search`}
                autoComplete="off"
              />
            </div>
          </div>
          <p className={`text-xs ${light ? "text-zinc-500" : "text-sprout-muted"}`}>
            {isFrench(lang)
              ? "Toute saisie fonctionne, même si le métier n'est pas dans la liste."
              : "Any entry works, even if the role is not in the list."}
          </p>
          {suggestionsList}
        </>
      )}
    </div>
  );
}
