import { createFixtureJobSchema, defineProviderCore } from "../core";

export const wttjRawJobSchema = createFixtureJobSchema("wttj");
export type WttjRawJob = typeof wttjRawJobSchema._output;

export const wttjProvider = defineProviderCore({
  provider: "wttj",
  schema: wttjRawJobSchema,
  authorizationStatus: "blocked",
  accessMethod: "written-permission-or-approved-feed-required",
  rateLimit: { requestsPerMinute: 1, concurrency: 1 },
});
