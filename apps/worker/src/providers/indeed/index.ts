import { createFixtureJobSchema, defineProviderCore } from "../core";

export const indeedRawJobSchema = createFixtureJobSchema("indeed");
export type IndeedRawJob = typeof indeedRawJobSchema._output;

export const indeedProvider = defineProviderCore({
  provider: "indeed",
  schema: indeedRawJobSchema,
  authorizationStatus: "blocked",
  accessMethod: "approved-partner-api-required",
  rateLimit: { requestsPerMinute: 1, concurrency: 1 },
});
