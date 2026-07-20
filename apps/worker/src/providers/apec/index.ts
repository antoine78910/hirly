import { createFixtureJobSchema, defineProviderCore } from "../core";

export const apecRawJobSchema = createFixtureJobSchema("apec");
export type ApecRawJob = typeof apecRawJobSchema._output;

export const apecProvider = defineProviderCore({
  provider: "apec",
  schema: apecRawJobSchema,
  authorizationStatus: "unverified",
  accessMethod: "not-yet-verified",
  rateLimit: { requestsPerMinute: 1, concurrency: 1 },
});
