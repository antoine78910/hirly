import { createFixtureJobSchema, defineProviderCore } from "../core";

export const helloWorkRawJobSchema = createFixtureJobSchema("hellowork");
export type HelloWorkRawJob = typeof helloWorkRawJobSchema._output;

export const helloWorkProvider = defineProviderCore({
  provider: "hellowork",
  schema: helloWorkRawJobSchema,
  authorizationStatus: "unverified",
  accessMethod: "not-yet-verified",
  rateLimit: { requestsPerMinute: 1, concurrency: 1 },
});
