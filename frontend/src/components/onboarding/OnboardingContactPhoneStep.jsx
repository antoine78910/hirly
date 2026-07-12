import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
  countryFlag,
  filterPhoneCountries,
  findCountryByDial,
  findCountryByIso2,
} from "../../lib/phoneCountryCodes";
import {
  formatLocalPhoneDisplay,
  getPhoneLocalFormat,
  getPhonePlaceholder,
} from "../../lib/phoneLocalFormats";

export function getContactPhoneCopy(lang = "fr") {
  if (lang === "fr") {
    return {
      title: "Votre numéro pour postuler",
      subtitle:
        "Certaines offres exigent un numéro de téléphone pour accepter votre candidature et pour être recontacté ensuite.",
      label: "Numéro mobile",
      searchPlaceholder: "Rechercher un pays",
      hint: "Saisissez votre numéro sans l\u2019indicatif pays.",
    };
  }

  return {
    title: "Your number to apply",
    subtitle:
      "Some job listings require a phone number to accept your application and to reach you afterwards.",
    label: "Mobile number",
    searchPlaceholder: "Search country",
    hint: "Enter your number without the country code.",
  };
}

function PhoneCountryCodePicker({ lang, value, countryIso2, onCountryChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const copy = getContactPhoneCopy(lang);
  const selected = findCountryByIso2(countryIso2) || findCountryByDial(value);
  const countries = useMemo(() => filterPhoneCountries(query, lang), [query, lang]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-[5.5rem] shrink-0 items-center justify-center gap-0.5 border-r border-zinc-200 bg-zinc-50 px-2 py-3 text-sm font-semibold text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-linkedin/30 sm:w-[6rem]"
          aria-label={lang === "fr" ? "Indicatif pays" : "Country code"}
          data-testid="onboarding-phone-prefix"
        >
          <span className="truncate">{value}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[min(calc(100vw-2rem),18rem)] p-0"
        data-testid="phone-country-picker"
      >
        <div className="border-b border-zinc-100 p-2">
          <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2">
            <Search className="h-4 w-4 shrink-0 text-zinc-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={copy.searchPlaceholder}
              className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
              data-testid="phone-country-search"
            />
          </div>
        </div>
        <ul className="max-h-56 overflow-y-auto py-1" role="listbox">
          {countries.map((country) => {
            const selectedRow = selected?.iso2 === country.iso2 && selected?.dial === country.dial;
            return (
              <li key={`${country.iso2}-${country.dial}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedRow}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-50 ${
                    selectedRow ? "bg-violet-50 font-semibold text-linkedin" : "text-zinc-800"
                  }`}
                  onClick={() => {
                    onCountryChange({ dial: country.dial, iso2: country.iso2 });
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span className="text-base leading-none">{countryFlag(country.iso2)}</span>
                  <span className="min-w-0 flex-1 truncate">{country.label}</span>
                  <span className="shrink-0 tabular-nums text-zinc-500">{country.dial}</span>
                </button>
              </li>
            );
          })}
          {!countries.length ? (
            <li className="px-3 py-4 text-center text-sm text-zinc-500">
              {lang === "fr" ? "Aucun pays trouvé" : "No country found"}
            </li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export default function OnboardingContactPhoneStep({
  lang,
  phonePrefix,
  phoneCountryIso2,
  phoneLocal,
  onCountryChange,
  onPhoneChange,
  showLabel = true,
}) {
  const copy = getContactPhoneCopy(lang);
  const placeholder = getPhonePlaceholder(phoneCountryIso2, phonePrefix);
  const format = getPhoneLocalFormat(phoneCountryIso2, phonePrefix);
  const digitCount = String(phoneLocal || "").replace(/\D/g, "").length;

  const handlePhoneInput = (rawValue) => {
    onPhoneChange(formatLocalPhoneDisplay(rawValue, phoneCountryIso2, phonePrefix));
  };

  return (
    <div className="w-full" data-testid="onboarding-phone-field">
      {showLabel ? (
        <label htmlFor="onboarding-phone-input" className="mb-2 block text-sm font-medium text-zinc-800">
          {copy.label}
        </label>
      ) : null}
      <div className="flex overflow-hidden rounded-xl border border-zinc-200 bg-white focus-within:border-linkedin focus-within:ring-2 focus-within:ring-linkedin/20">
        <PhoneCountryCodePicker
          lang={lang}
          value={phonePrefix}
          countryIso2={phoneCountryIso2}
          onCountryChange={onCountryChange}
        />
        <input
          id="onboarding-phone-input"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={phoneLocal}
          onChange={(e) => handlePhoneInput(e.target.value)}
          placeholder={placeholder}
          maxLength={format.maxDigits + Math.max(0, format.groups.length - 1)}
          className="min-w-0 flex-1 px-3 py-3 text-base text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
          data-testid="onboarding-phone-input"
          aria-describedby="onboarding-phone-hint"
        />
      </div>
      <p id="onboarding-phone-hint" className="mt-2 text-xs leading-relaxed text-zinc-500">
        {copy.hint}
        {" "}
        <span className="tabular-nums text-zinc-600">
          {lang === "fr" ? "Ex." : "e.g."}
          {" "}
          {placeholder}
          {" "}
          (
          {format.minDigits === format.maxDigits
            ? `${format.maxDigits} ${lang === "fr" ? "chiffres" : "digits"}`
            : `${format.minDigits}–${format.maxDigits} ${lang === "fr" ? "chiffres" : "digits"}`}
          {digitCount > 0 ? ` · ${digitCount}/${format.maxDigits}` : ""}
          )
        </span>
      </p>
    </div>
  );
}
