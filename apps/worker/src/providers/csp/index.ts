import { z } from "zod";
import {
  dataGouvHttpsUrlIssue,
  FixtureOnlyDataGouvSourceAdapter,
  type DataGouvFixtureCursor,
  type DataGouvFixtureScope,
  type DataGouvRawJob,
} from "@hirly/ingestion/data-gouv";
import type { SourceAdapter } from "@hirly/ingestion";

const safeHttpsUrlSchema = z.url().superRefine((value, context) => {
  const issue = dataGouvHttpsUrlIssue(value);
  if (issue) {
    context.addIssue({
      code: "custom",
      message: `CSP fixture apply URLs ${issue}`,
    });
  }
});

export const CSP_DATASET_ID =
  "les-offres-diffusees-sur-choisir-le-service-public" as const;
export const CSP_QUALIFICATION_RESOURCE_ID =
  "csp-qualification-fixture-v1" as const;
export const CSP_DATASET_URL =
  "https://www.data.gouv.fr/datasets/les-offres-diffusees-sur-choisir-le-service-public" as const;

export const cspRawJobSchema = z
  .object({
    datasetId: z.literal(CSP_DATASET_ID),
    resourceId: z.literal(CSP_QUALIFICATION_RESOURCE_ID),
    recordId: z.string().trim().min(1).max(512),
    title: z.string().trim().min(1).max(512),
    employer: z.string().trim().min(1).max(512),
    location: z.string().trim().min(1).max(512),
    countryCode: z.union([z.literal("FR"), z.literal("France")]),
    description: z.string().max(100_000).default(""),
    contractType: z.string().trim().min(1).max(128).nullable(),
    status: z.string().trim().min(1).max(64).nullable(),
    applyUrls: z.array(safeHttpsUrlSchema).min(1).max(10),
    sourceUrl: z.literal(CSP_DATASET_URL),
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
    sourceDocument: z.record(z.string(), z.unknown()),
  })
  .strict();

export type CspRawJob = z.infer<typeof cspRawJobSchema>;

class CspFixtureSourceAdapter extends FixtureOnlyDataGouvSourceAdapter<CspRawJob> {
  constructor(rows: readonly CspRawJob[], policyId: string) {
    super(rows, {
      policyId,
      licenceName: "Licence Ouverte 2.0",
      attributionText:
        "Choisir le Service Public — fixture de qualification; attribution de production soumise à l’approbation de la ressource exacte.",
      sourceUrl: CSP_DATASET_URL,
    });
  }

  override normalize(
    rawValue: CspRawJob,
    context: Parameters<
      FixtureOnlyDataGouvSourceAdapter<CspRawJob>["normalize"]
    >[1],
  ) {
    return super.normalize(cspRawJobSchema.parse(rawValue), context);
  }
}

export function createCspFixtureSourceAdapter(
  rows: readonly DataGouvRawJob[],
  policyId: string,
): SourceAdapter<CspRawJob, DataGouvFixtureCursor, DataGouvFixtureScope> & {
  readonly canonicalWriteReady: false;
  readonly sourcePolicyEligible: false;
} {
  return new CspFixtureSourceAdapter(
    rows.map((row) => cspRawJobSchema.parse(row)),
    policyId,
  );
}
