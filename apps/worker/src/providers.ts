import type { Provider } from "@hirly/contracts";
import type { ProviderCore } from "./providers/core";
import { PermanentTaskError } from "./runtime/retry";
import { apecProvider } from "./providers/apec";
import { helloWorkProvider } from "./providers/hellowork";
import { wttjProvider } from "./providers/wttj";
import { indeedProvider } from "./providers/indeed";
import { franceTravailProvider } from "./providers/france-travail";
import { dataGouvProvider } from "./providers/data-gouv";
import { greenhouseProvider } from "./providers/greenhouse";
import { leverProvider } from "./providers/lever";

export const providerModules = {
  apec: apecProvider,
  hellowork: helloWorkProvider,
  wttj: wttjProvider,
  indeed: indeedProvider,
  france_travail: franceTravailProvider,
  data_gouv: dataGouvProvider,
  greenhouse: greenhouseProvider,
  lever: leverProvider,
} satisfies Record<Provider, ProviderCore<unknown>>;

export function getProviderModule(provider: Provider): ProviderCore<unknown> {
  return providerModules[provider];
}

export function assertProviderTransportActive(provider: Provider): void {
  const module = getProviderModule(provider);
  if (!module.liveTransportReady) {
    throw new PermanentTaskError(
      "authorization_blocked",
      `provider transport is inactive: ${provider}`,
    );
  }
}

export {
  apecProvider,
  helloWorkProvider,
  wttjProvider,
  indeedProvider,
  franceTravailProvider,
  dataGouvProvider,
  greenhouseProvider,
  leverProvider,
};
