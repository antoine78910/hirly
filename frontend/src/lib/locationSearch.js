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

export function buildTypedLocationResult(query) {
  const trimmed = (query || "").trim();
  if (trimmed.length < 2) return [];

  const label = trimmed
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

  return [{
    id: `typed:${normalizeLabel(label)}`,
    label,
    source: "typed",
    place_id: "",
    country: "",
    country_code: "",
    lat: null,
    lng: null,
    kind: "city",
  }];
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
