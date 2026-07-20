import { z } from "zod";
import { defineProviderCore } from "../core";

export const dataGouvProviderJobSchema = z
  .object({
    provider: z.literal("data_gouv"),
    externalId: z.string().trim().min(1).max(512),
    title: z.string().trim().min(1).max(512),
    company: z.string().trim().min(1).max(512),
    location: z.string().trim().min(1).max(512),
    countryCode: z.string().trim().min(2).max(64),
    description: z.string().max(100_000).default(""),
    contractType: z.string().trim().min(1).max(128).nullable().default(null),
    status: z.string().trim().min(1).max(64).nullable().default(null),
    applyUrls: z.array(z.url()).max(10).default([]),
    sourceDocument: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export type DataGouvProviderJob = z.infer<
  typeof dataGouvProviderJobSchema
>;

export const dataGouvProvider =
  defineProviderCore<"data_gouv", DataGouvProviderJob>({
    provider: "data_gouv",
    schema: dataGouvProviderJobSchema,
    authorizationStatus: "unverified",
    accessMethod:
      "fixture-only data.gouv resource snapshots; live resource transport requires source-specific reviewed evidence",
    rateLimit: {
      requestsPerMinute: 1,
      concurrency: 1,
    },
    shadowModeReady: false,
  });
