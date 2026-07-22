import type {
  FeedCandidate,
  FeedCursorPosition,
  FeedEffectiveQuery,
  FeedReadRepository,
  FeedReadSnapshot,
} from "@hirly/feed-v2";

export const FEED_V2_INDEXED_READ_SQL = `
WITH profile AS (
  SELECT * FROM public.read_candidate_search_profile($1) WHERE status = 'active'
), action_meta AS (
  SELECT coalesce(max(candidate_version), 0)::text AS action_watermark
  FROM public.read_candidate_actions($1)
), effective_query AS (
  SELECT
    $5::text AS query_fingerprint,
    NULLIF($6::text, '') AS role,
    $7::text[] AS country_codes,
    $8::text[] AS work_modes,
    $9::text[] AS contract_families,
    $10::double precision[] AS latitudes,
    $11::double precision[] AS longitudes,
    $12::text[] AS free_text_locations,
    $13::integer AS radius_km,
    $14::boolean AS include_unknown_location
), coordinate_locations AS (
  SELECT location.latitude, location.longitude
  FROM effective_query
  CROSS JOIN LATERAL unnest(
    effective_query.latitudes,
    effective_query.longitudes
  ) AS location(latitude, longitude)
  WHERE location.latitude IS NOT NULL AND location.longitude IS NOT NULL
), role_terms AS (
  -- Candidate profiles may select multiple roles. They are OR-ed for
  -- eligibility; a job receives the strongest matching role score below.
  SELECT
    coalesce(
      array_agg(DISTINCT role_label ORDER BY role_label)
        FILTER (WHERE role_label IS NOT NULL AND btrim(role_label) <> ''),
      ARRAY[]::text[]
    ) AS labels,
    coalesce(
      array_agg(DISTINCT token ORDER BY token) FILTER (
        WHERE char_length(token) >= 3
          -- These generic titles make nearly every engineering vacancy eligible.
          -- Keep the distinctive role tokens (for example "fullstack") so aliases
          -- such as "Développeur FullStack" still match a Fullstack Engineer.
          AND token NOT IN ('engineer', 'developer', 'developpeur', 'ingenieur', 'software')
      ),
      ARRAY[]::text[]
    ) AS tokens
  FROM effective_query
  CROSS JOIN profile
  CROSS JOIN LATERAL (
    SELECT CASE
      -- An explicit Swipe search refines the saved profile; it must not erase
      -- the candidate's other selected roles. This keeps a multi-role profile
      -- (for example Fullstack + Backend + Frontend) OR-matched while users
      -- adjust location/radius or type a primary role in the Swipe header.
      WHEN effective_query.role IS NOT NULL
        AND cardinality(profile.target_role_labels_normalized) > 0
        THEN array_append(profile.target_role_labels_normalized, effective_query.role)
      WHEN effective_query.role IS NOT NULL THEN ARRAY[effective_query.role]
      WHEN cardinality(profile.target_role_labels_normalized) > 0
        THEN profile.target_role_labels_normalized
      WHEN profile.target_role_label_normalized IS NOT NULL
        THEN ARRAY[profile.target_role_label_normalized]
      ELSE ARRAY[]::text[]
    END AS labels
  ) AS selected_roles
  LEFT JOIN LATERAL unnest(selected_roles.labels) AS role_label ON true
  LEFT JOIN LATERAL regexp_split_to_table(
    lower(coalesce(role_label, '')),
    '[^[:alnum:]]+'
  ) AS token ON true
), recency_candidates AS MATERIALIZED (
  SELECT document.*
  FROM public.job_search_documents AS document
  WHERE document.lifecycle_status = 'active'
), inventory_meta AS (
  SELECT concat(
    coalesce((
      SELECT document.projected_at
      FROM public.job_search_documents AS document
      WHERE document.lifecycle_status = 'active'
      ORDER BY document.projected_at DESC
      LIMIT 1
    ), '-infinity'::timestamptz)::text,
    '#', max(effective_query.query_fingerprint)
  ) AS snapshot_version
  FROM effective_query
), scored AS (
  SELECT
    document.canonical_group_id::text AS canonical_group_id,
    document.preferred_job_id,
    document.job_version::text AS job_version,
    document.canonical_group_id::text AS company_key,
    round(LEAST(1.0, (
      0.10
      -- A role phrase/all-term match ranks above a single compatible token;
      -- partial matches remain eligible instead of disappearing from inventory.
      + CASE
        WHEN cardinality(role_terms.labels) = 0 THEN 0.20
        WHEN EXISTS (
          SELECT 1 FROM unnest(role_terms.labels) AS role_label
          WHERE lower(document.search_text) LIKE '%' || lower(role_label) || '%'
        ) THEN 0.35
        WHEN EXISTS (
          SELECT 1 FROM unnest(role_terms.labels) AS role_label
          WHERE document.search_vector @@ websearch_to_tsquery('simple', role_label)
        ) THEN 0.25
        WHEN EXISTS (
          SELECT 1 FROM unnest(role_terms.tokens) AS token
          WHERE document.search_vector @@ to_tsquery('simple', token || ':*')
        ) THEN 0.10
        ELSE 0
      END
      + CASE WHEN document.skill_codes && profile.skill_ids THEN 0.20 ELSE 0 END
      + CASE WHEN document.country_codes && profile.country_codes THEN 0.15 ELSE 0 END
      + CASE WHEN document.contract_families && profile.contract_types THEN 0.10 ELSE 0 END
      + CASE WHEN document.work_modes && profile.work_modes THEN 0.10 ELSE 0 END
      + CASE WHEN document.sector_ids && profile.sector_ids THEN 0.10 ELSE 0 END
      + CASE WHEN document.industry_ids && profile.industry_ids THEN 0.10 ELSE 0 END
    ))::numeric, 6)::double precision AS relevance_score,
    document.fulfillment_route,
    public.candidate_group_is_excluded($1, document.canonical_group_id) AS action_excluded,
    (document.source_eligible AND document.policy_eligible) AS policy_eligible,
    (
      document.lifecycle_status = 'active'
      AND document.validation_status = 'valid'
      AND document.applyability_tier <> 'blocked'
      AND (document.expires_at IS NULL OR document.expires_at > clock_timestamp())
    ) AS lifecycle_eligible
  FROM recency_candidates AS document
  CROSS JOIN profile
  CROSS JOIN effective_query
  CROSS JOIN role_terms
  WHERE document.lifecycle_status = 'active'
    AND (
      (
        effective_query.query_fingerprint = 'candidate-profile'
        AND (
          document.role_family_codes && profile.role_family_ids
          OR EXISTS (
            SELECT 1 FROM unnest(role_terms.labels) AS role_label
            WHERE document.search_vector @@ websearch_to_tsquery('simple', role_label)
          )
          OR EXISTS (
            SELECT 1 FROM unnest(role_terms.tokens) AS token
            WHERE document.search_vector @@ to_tsquery('simple', token || ':*')
          )
        )
      )
      OR (
        effective_query.query_fingerprint <> 'candidate-profile'
        AND (
          cardinality(role_terms.labels) = 0
          OR EXISTS (
            SELECT 1 FROM unnest(role_terms.labels) AS role_label
            WHERE document.search_vector @@ websearch_to_tsquery('simple', role_label)
          )
          OR EXISTS (
            SELECT 1 FROM unnest(role_terms.tokens) AS token
            WHERE document.search_vector @@ to_tsquery('simple', token || ':*')
          )
        )
      )
    )
    AND (
      cardinality(profile.sector_ids) = 0
      OR document.sector_ids && profile.sector_ids
    )
    AND (
      cardinality(profile.industry_ids) = 0
      OR document.industry_ids && profile.industry_ids
    )
    AND (
      effective_query.query_fingerprint = 'candidate-profile'
      OR cardinality(effective_query.country_codes) = 0
      OR document.country_codes && effective_query.country_codes
      OR (effective_query.include_unknown_location AND document.location_unknown)
    )
    AND (
      effective_query.query_fingerprint = 'candidate-profile'
      OR (
        NOT EXISTS (SELECT 1 FROM coordinate_locations)
        AND cardinality(effective_query.free_text_locations) = 0
      )
      OR EXISTS (
        SELECT 1
        FROM coordinate_locations AS location
        WHERE document.latitude IS NOT NULL
          AND document.longitude IS NOT NULL
          AND 6371.0 * acos(LEAST(1.0, GREATEST(-1.0,
            sin(radians(document.latitude)) * sin(radians(location.latitude))
            + cos(radians(document.latitude)) * cos(radians(location.latitude))
            * cos(radians(document.longitude - location.longitude))
          ))) <= effective_query.radius_km
      )
      OR EXISTS (
        SELECT 1
        FROM unnest(effective_query.free_text_locations) AS location_name
        WHERE document.search_text ILIKE '%' || location_name || '%'
      )
      OR (effective_query.include_unknown_location AND document.location_unknown)
    )
    AND (
      effective_query.query_fingerprint = 'candidate-profile'
      OR cardinality(effective_query.work_modes) = 0
      OR document.work_modes && effective_query.work_modes
    )
    AND (
      effective_query.query_fingerprint = 'candidate-profile'
      OR cardinality(effective_query.contract_families) = 0
      OR document.contract_families && effective_query.contract_families
    )
    AND document.last_seen_at >=
      clock_timestamp() - make_interval(days => profile.freshness_window_days)
), paged AS (
  SELECT * FROM scored
  WHERE ($2::double precision IS NULL OR relevance_score < $2
    OR (relevance_score = $2 AND canonical_group_id > $3::text))
  ORDER BY relevance_score DESC, canonical_group_id ASC
  LIMIT $4
)
SELECT
  concat(profile.version::text, '#', effective_query.query_fingerprint)
    AS profile_version,
  action_meta.action_watermark,
  inventory_meta.snapshot_version,
  effective_query.query_fingerprint,
  paged.*
FROM profile
CROSS JOIN action_meta
CROSS JOIN inventory_meta
CROSS JOIN effective_query
LEFT JOIN paged ON true
ORDER BY paged.relevance_score DESC, paged.canonical_group_id ASC;
`.trim();

interface FeedReadRow {
  profile_version: string;
  action_watermark: string;
  snapshot_version: string;
  query_fingerprint: string;
  canonical_group_id: string | null;
  preferred_job_id: string | null;
  job_version: string | null;
  company_key: string | null;
  relevance_score: number | null;
  fulfillment_route: FeedCandidate["fulfillmentRoute"] | null;
  action_excluded: boolean | null;
  policy_eligible: boolean | null;
  lifecycle_eligible: boolean | null;
}

export interface FeedReadSqlClient {
  unsafe(query: string, parameters: readonly unknown[]): Promise<readonly FeedReadRow[]>;
}

function queryParameters(query: FeedEffectiveQuery | null): readonly unknown[] {
  if (!query) {
    return ["candidate-profile", null, [], [], [], [], [], [], 1, false];
  }
  const countryCodes = [
    query.countryCode,
    ...query.locations.map((location) => location.countryCode),
  ].filter((value): value is string => value !== null);
  const locations = query.locations.flatMap((location) =>
    location.latitude === null || location.longitude === null
      ? []
      : [{ latitude: location.latitude, longitude: location.longitude }],
  );
  // Many provider records have a normalized city/country but no coordinates.
  // Make an explicitly selected location usable for those records as well as
  // for coordinate-bearing inventory. The leading label segment is the city
  // for our canonical location labels (for example "Paris, Île-de-France").
  const freeTextLocations = [
    ...new Set([
      ...query.freeTextLocations,
      ...query.locations.flatMap((location) => {
        const city = location.label.split(",", 1)[0]?.trim();
        return city ? [location.label, city] : [location.label];
      }),
    ]),
  ].sort();
  return [
    query.fingerprint,
    query.role,
    [...new Set(countryCodes)].sort(),
    query.workModes,
    [
      ...new Set(
        query.jobTypes.flatMap((value) => {
          const normalized = value.toLowerCase().replaceAll("_", "-");
          return normalized === "full-time" ? ["full-time", "permanent"] : [normalized];
        }),
      ),
    ].sort(),
    locations.map((location) => location.latitude),
    locations.map((location) => location.longitude),
    freeTextLocations,
    query.radiusKm,
    query.includeUnknownLocation,
  ];
}

export class PostgresFeedReadRepository implements FeedReadRepository {
  constructor(private readonly sql: FeedReadSqlClient) {}

  async readIndexedCandidates(input: {
    candidateId: string;
    effectiveQuery: FeedEffectiveQuery | null;
    limit: number;
    after: FeedCursorPosition | null;
  }): Promise<FeedReadSnapshot> {
    if (!input.candidateId || input.candidateId.length > 256) {
      throw new Error("invalid_candidate_scope");
    }
    const limit = Math.max(1, Math.min(Math.trunc(input.limit), 1_000));
    const queryFingerprint = input.effectiveQuery?.fingerprint ?? "candidate-profile";
    const rows = await this.sql.unsafe(FEED_V2_INDEXED_READ_SQL, [
      input.candidateId,
      input.after?.relevanceScore ?? null,
      input.after?.canonicalGroupId ?? null,
      limit + 1,
      ...queryParameters(input.effectiveQuery),
    ]);
    const metadata = rows[0];
    if (!metadata) {
      return {
        snapshotVersion: `unavailable#${queryFingerprint}`,
        profileVersion: `unavailable#${queryFingerprint}`,
        actionWatermark: "0",
        queryFingerprint,
        profileReady: false,
        inventoryState: "matching_pending",
        candidates: [],
        hasMore: false,
      };
    }
    if (metadata.query_fingerprint !== queryFingerprint) {
      throw new Error("query_identity_mismatch");
    }
    const candidates = rows.flatMap((row): FeedCandidate[] => {
      if (
        row.canonical_group_id === null ||
        row.preferred_job_id === null ||
        row.job_version === null ||
        row.company_key === null ||
        row.relevance_score === null ||
        row.fulfillment_route === null
      ) {
        return [];
      }
      return [
        {
          canonicalGroupId: row.canonical_group_id,
          preferredJobId: row.preferred_job_id,
          jobVersion: row.job_version,
          companyKey: row.company_key,
          relevanceScore: row.relevance_score,
          fulfillmentRoute: row.fulfillment_route,
          actionExcluded: row.action_excluded === true,
          policyEligible: row.policy_eligible === true,
          lifecycleEligible: row.lifecycle_eligible === true,
        },
      ];
    });
    return {
      snapshotVersion: metadata.snapshot_version,
      profileVersion: metadata.profile_version,
      actionWatermark: metadata.action_watermark,
      queryFingerprint: metadata.query_fingerprint,
      profileReady: true,
      inventoryState: candidates.length === 0 ? "inventory_gap" : "ready",
      candidates: candidates.slice(0, limit),
      hasMore: candidates.length > limit,
    };
  }
}
