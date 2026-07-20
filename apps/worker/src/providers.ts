import type { Provider } from "@hirly/contracts";
import type { ProviderCore } from "./providers/core";
import { apecProvider } from "./providers/apec";
import { helloWorkProvider } from "./providers/hellowork";
import { wttjProvider } from "./providers/wttj";
import { indeedProvider } from "./providers/indeed";

export const providerModules = {
  apec: apecProvider,
  hellowork: helloWorkProvider,
  wttj: wttjProvider,
  indeed: indeedProvider,
} satisfies Record<Provider, ProviderCore<unknown>>;

export function getProviderModule(provider: Provider): ProviderCore<unknown> {
  return providerModules[provider];
}

export {
  apecProvider,
  helloWorkProvider,
  wttjProvider,
  indeedProvider,
};
