import { z } from "zod";
import {
  FixtureOnlyDataGouvSourceAdapter,
  type DataGouvAttribution,
  type DataGouvRawJob,
  type DisabledDataGouvSourceAdapter,
} from "@hirly/ingestion/data-gouv";

export const BPCE_DATASET_URL =
  "https://www.data.gouv.fr/datasets/groupe-bpce-offres-emploi-publiques";

const httpsUrlSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    context.addIssue({
      code: "custom",
      message: "BPCE fixture URLs must use HTTPS without credentials",
    });
  }
});

export const bpceOpenFeedRawRecordSchema = z
  .object({
    reference: z.string().trim().min(1).max(512),
    intitule: z.string().trim().min(1).max(512),
    employeur: z.string().trim().min(1).max(512),
    lieu: z.string().trim().min(1).max(512),
    pays: z.string().trim().min(2).max(64),
    description: z.string().max(100_000).default(""),
    typeContrat: z.string().trim().min(1).max(128).nullable().default(null),
    statut: z.string().trim().min(1).max(64).nullable().default(null),
    urlCandidature: httpsUrlSchema,
    datePublication: z.iso.datetime({ offset: true }).nullable().default(null),
    dateExpiration: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .strict();

export type BpceOpenFeedRawRecord = z.infer<
  typeof bpceOpenFeedRawRecordSchema
>;

export const bpceOpenFeedFixtureSchema = z
  .object({
    schemaVersion: z.literal("hirly.bpce-open-feed-fixture.v1"),
    provenance: z
      .object({
        kind: z.literal("synthetic_sanitized"),
        source: z.literal(BPCE_DATASET_URL),
        containsPersonalData: z.literal(false),
        productionEligible: z.literal(false),
      })
      .strict(),
    datasetId: z.string().trim().min(1).max(512),
    resourceId: z.string().trim().min(1).max(512),
    raw: z.array(bpceOpenFeedRawRecordSchema).max(500),
  })
  .strict();

export type BpceOpenFeedFixture = z.infer<
  typeof bpceOpenFeedFixtureSchema
>;

function toDataGouvRawJob(
  datasetId: string,
  resourceId: string,
  rawValue: BpceOpenFeedRawRecord,
): DataGouvRawJob {
  const raw = bpceOpenFeedRawRecordSchema.parse(rawValue);
  return {
    datasetId,
    resourceId,
    recordId: raw.reference,
    title: raw.intitule,
    employer: raw.employeur,
    location: raw.lieu,
    countryCode: raw.pays,
    description: raw.description,
    contractType: raw.typeContrat,
    status: raw.statut,
    applyUrls: [raw.urlCandidature],
    sourceUrl: BPCE_DATASET_URL,
    publishedAt: raw.datePublication,
    expiresAt: raw.dateExpiration,
    sourceDocument: { ...raw },
  };
}

export class BpceFixtureSourceAdapter extends FixtureOnlyDataGouvSourceAdapter {
  constructor(fixtureValue: BpceOpenFeedFixture, policyId: string) {
    const fixture = bpceOpenFeedFixtureSchema.parse(fixtureValue);
    const rows = fixture.raw.map((raw) =>
      toDataGouvRawJob(fixture.datasetId, fixture.resourceId, raw),
    );
    const attribution: DataGouvAttribution = {
      policyId,
      licenceName: "Licence Ouverte 2.0",
      attributionText:
        "Groupe BPCE — data.gouv.fr; production attribution wording remains subject to source-specific legal review.",
      sourceUrl: BPCE_DATASET_URL,
    };
    super(rows, attribution);
  }
}

export function createBpceFixtureSourceAdapter(
  fixture: BpceOpenFeedFixture,
  policyId: string,
): DisabledDataGouvSourceAdapter<DataGouvRawJob> {
  return new BpceFixtureSourceAdapter(fixture, policyId);
}
