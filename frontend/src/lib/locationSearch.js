const PHOTON_URL = "https://photon.komoot.io/api/";

const RELEVANT_KINDS = new Set([
  "city",
  "town",
  "village",
  "hamlet",
  "municipality",
  "borough",
  "suburb",
  "locality",
  "county",
  "state",
  "region",
  "district",
  "province",
]);

function normalizeLabel(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function formatPhotonLabel(properties) {
  const name = properties.name || properties.city || properties.town || properties.village || "";
  if (!name) return "";

  const parts = [name];
  const state = properties.state || properties.county || "";
  const country = properties.country || "";

  if (state && state !== name && !parts.includes(state)) {
    parts.push(state);
  }
  if (country && !parts.includes(country)) {
    parts.push(country);
  }

  return parts.join(", ");
}

function photonFeatureToResult(feature, index) {
  const properties = feature.properties || {};
  const label = formatPhotonLabel(properties);
  if (!label) return null;

  const coords = feature.geometry?.coordinates || [];

  return {
    id: `photon:${properties.osm_type || "n"}:${properties.osm_id || index}`,
    label,
    source: "photon",
    place_id: String(properties.osm_id || ""),
    country: properties.country || "",
    country_code: (properties.countrycode || "").toLowerCase(),
    lat: coords[1] ?? null,
    lng: coords[0] ?? null,
    kind: properties.type || properties.osm_value || "place",
  };
}

function scorePhotonResult(query, result) {
  const q = normalizeLabel(query);
  const label = normalizeLabel(result.label);
  let score = 0;

  if (label.startsWith(q)) score += 100;
  if (label.includes(q)) score += 60;
  if (RELEVANT_KINDS.has(result.kind)) score += 20;
  if (result.country_code) score += 5;

  return score;
}

const FRENCH_CITY_MARKERS = new Set([
  "dijon", "paris", "lyon", "marseille", "toulouse", "nice", "nantes", "strasbourg",
  "lille", "montpellier", "rennes", "grenoble", "bordeaux", "reims", "metz", "nancy",
  "angers", "caen", "rouen", "tours", "besancon", "brest", "amiens", "orleans",
  "perpignan", "bayonne", "pau", "avignon", "annecy", "chambery", "valence", "nimes",
  "mulhouse", "colmar", "lorient", "vannes", "quimper", "saint etienne", "clermont ferrant",
]);

function looksLikeFranceLocation(text) {
  const normalized = normalizeLabel(text);
  if (!normalized) return false;
  if (normalized.includes("france")) return true;
  if (FRENCH_CITY_MARKERS.has(normalized)) return true;
  const cityPart = normalized.split(",")[0]?.trim();
  return Boolean(cityPart && FRENCH_CITY_MARKERS.has(cityPart));
}

export function enrichLocationData(locationData) {
  if (!locationData || typeof locationData !== "object") return locationData;

  const label = String(locationData.location_label || locationData.label || "").trim();
  if (!label) return locationData;

  const isFrench = looksLikeFranceLocation(label);
  const displayLabel = isFrench && !label.toLowerCase().includes("france")
    ? `${label.split(",")[0].trim()}, France`
    : label;
  const countryCode = String(locationData.country_code || "").toLowerCase().trim()
    || (isFrench ? "fr" : "");

  return {
    ...locationData,
    location_label: displayLabel,
    label: displayLabel,
    country: locationData.country || (isFrench ? "France" : ""),
    country_code: countryCode,
  };
}

export function buildTypedLocationResult(query) {
  const trimmed = (query || "").trim();
  if (trimmed.length < 2) return [];

  const label = trimmed
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

  const isFrench = looksLikeFranceLocation(label);
  const displayLabel = isFrench && !label.toLowerCase().includes("france")
    ? `${label}, France`
    : label;

  return [enrichLocationData({
    id: `typed:${normalizeLabel(displayLabel)}`,
    label: displayLabel,
    source: "typed",
    place_id: "",
    country: isFrench ? "France" : "",
    country_code: isFrench ? "fr" : "",
    lat: null,
    lng: null,
    kind: "city",
  })];
}

/** Browser-side fallback when the backend location API is unavailable. */
export async function searchLocationsClient(query, limit = 12, signal) {
  const q = (query || "").trim();
  if (q.length < 1) return [];

  const response = await fetch(
    `${PHOTON_URL}?${new URLSearchParams({
      q,
      limit: String(Math.min(limit * 2, 20)),
      lang: "en",
    })}`,
    { signal },
  );

  if (!response.ok) {
    throw new Error(`Photon search failed (${response.status})`);
  }

  const payload = await response.json();
  const seen = new Set();
  const results = [];

  for (const [index, feature] of (payload.features || []).entries()) {
    const result = photonFeatureToResult(feature, index);
    if (!result) continue;

    const key = normalizeLabel(result.label);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    results.push({ ...result, _score: scorePhotonResult(q, result) });
  }

  return results
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score, ...row }) => row);
}

/** Prioritize locations in the same country/region as the user's current target. */
export function rankLocationSuggestions(labels, hint, limit = 12) {
  const list = Array.isArray(labels) ? labels : [];
  if (!list.length) return [];

  const country = (hint || "")
    .split(",")
    .slice(-1)[0]
    ?.trim()
    .toLowerCase();

  if (!country || country === "anywhere") {
    return list.slice(0, limit);
  }

  return [...list]
    .sort((a, b) => {
      const aMatch = a.toLowerCase().includes(country);
      const bMatch = b.toLowerCase().includes(country);
      return Number(bMatch) - Number(aMatch);
    })
    .slice(0, limit);
}
