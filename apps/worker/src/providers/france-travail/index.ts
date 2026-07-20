import { z } from "zod";
import {
  DisabledProviderTransport,
  type ProviderCore,
} from "../core";

const optionalText = z.string().trim().min(1).nullable().optional();

export const franceTravailRawJobSchema = z
  .object({
    id: z.string().trim().min(1).max(512),
    intitule: z.string().trim().min(1).max(512),
    romeLibelle: optionalText,
    description: z.string().default(""),
    entreprise: z
      .object({
        nom: optionalText,
        enseigne: optionalText,
      })
      .passthrough()
      .default({}),
    lieuTravail: z
      .object({
        libelle: optionalText,
        commune: optionalText,
      })
      .passthrough()
      .default({}),
    typeContrat: optionalText,
    typeContratLibelle: optionalText,
    contact: z
      .object({
        urlPostulation: optionalText,
      })
      .passthrough()
      .default({}),
    origineOffre: z
      .object({
        urlOrigine: optionalText,
      })
      .passthrough()
      .default({}),
    dateActualisation: optionalText,
    dateCreation: optionalText,
    etat: optionalText,
  })
  .passthrough();

export type FranceTravailRawJob = z.output<typeof franceTravailRawJobSchema>;

function applyUrls(raw: FranceTravailRawJob): string[] {
  const detail =
    `https://candidat.francetravail.fr/offres/recherche/detail/` +
    encodeURIComponent(raw.id);
  return [
    raw.contact.urlPostulation,
    raw.origineOffre.urlOrigine,
    detail,
  ].filter((value): value is string => Boolean(value));
}

export const franceTravailProvider: ProviderCore<FranceTravailRawJob> = {
  provider: "france_travail",
  authorizationStatus: "unverified",
  accessMethod: "official-api-existing-python-owner",
  rateLimit: { requestsPerMinute: 1, concurrency: 1 },
  coreReady: true,
  liveTransportReady: false,
  shadowModeReady: true,
  canonicalWriteReady: false,
  activationRequirements: [
    "run fixture parity against the Python France Travail provider",
    "install and verify provider ownership claims and epochs",
    "exercise whole-provider rollback through none",
    "approve current France Travail policy evidence",
    "assign exactly one TypeScript canonical writer",
    "enable persisted scheduling only after the canary passes",
  ],
  adapter: {
    provider: "france_travail",
    normalizeRaw(value) {
      const raw = franceTravailRawJobSchema.parse(value);
      const company =
        raw.entreprise.nom ??
        raw.entreprise.enseigne ??
        "Entreprise confidentielle";
      const location =
        raw.lieuTravail.libelle ??
        raw.lieuTravail.commune ??
        "France";
      return {
        envelope: {
          provider: "france_travail",
          externalId: raw.id,
          payload: raw,
        },
        title: raw.intitule || raw.romeLibelle || "",
        company,
        location,
        countryCode: "FR",
        description: raw.description,
        contractType: raw.typeContrat,
        status: raw.etat,
        applyUrls: applyUrls(raw),
      };
    },
  },
  transport: new DisabledProviderTransport<FranceTravailRawJob>(
    "france_travail",
  ),
};
