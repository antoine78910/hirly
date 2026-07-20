import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  sourceTrialManifestSchema,
  type SourceTrialManifest,
} from "@hirly/contracts";
import { createDatabase } from "@hirly/db";
import {
  parseCspTrialResourceManifest,
  persistCspSourceTrial,
  previewCspSourceTrial,
  type CspSourceTrialPreview,
} from "./csp-source-trial";
import {
  parseBpceTrialResourceManifest,
  persistBpceSourceTrial,
  previewBpceSourceTrial,
  type BpceSourceTrialPreview,
} from "./bpce-source-trial";
import {
  parseDataGouvTrialResourceManifest,
  persistDataGouvSourceTrial,
  previewDataGouvSourceTrial,
  type DataGouvSourceTrialPreview,
} from "./data-gouv-source-trial";
import { PostgresSourceTrialEvidenceRepository } from "./source-trial-cli";

type FrenchTrialSource = "csp" | "data-gouv" | "bpce";
type FrenchSourceTrialPreview =
  | CspSourceTrialPreview
  | DataGouvSourceTrialPreview
  | BpceSourceTrialPreview;

export type FrenchSourceTrialCliCommand =
  | {
      type: "preview";
      source: FrenchTrialSource;
      manifestPath: string;
      resourceManifestPath: string;
      approvedManifestDigest: string;
      responsePath: string;
      outputPath: string;
    }
  | {
      type: "run";
      source: FrenchTrialSource;
      manifestPath: string;
      resourceManifestPath: string;
      approvedManifestDigest: string;
      outputPath: string;
    };

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function parseFrenchSourceTrialArgs(
  args: string[],
): FrenchSourceTrialCliCommand {
  const [source, type, ...rest] = args;
  if (
    !["csp", "data-gouv", "bpce"].includes(source ?? "") ||
    !["preview", "run"].includes(type ?? "")
  ) {
    throw new Error(
      "usage: french-source-trial <csp|data-gouv|bpce> <preview|run> --manifest <path> --resource-manifest <path> --approved-manifest-digest <sha256> [--response <path>] --output <path>",
    );
  }
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (
      ![
        "--manifest",
        "--resource-manifest",
        "--approved-manifest-digest",
        "--response",
        "--output",
      ].includes(name) ||
      !value ||
      value.startsWith("--")
    ) {
      throw new Error(`invalid french-source-trial argument: ${name ?? "missing"}`);
    }
    if (values.has(name)) {
      throw new Error(`duplicate french-source-trial argument: ${name}`);
    }
    values.set(name, value);
  }

  const manifestPath = values.get("--manifest");
  const resourceManifestPath = values.get("--resource-manifest");
  const approvedManifestDigest = values.get("--approved-manifest-digest");
  const outputPath = values.get("--output");
  if (
    !manifestPath ||
    !resourceManifestPath ||
    !approvedManifestDigest ||
    !SHA256_PATTERN.test(approvedManifestDigest) ||
    !outputPath
  ) {
    throw new Error(
      "french-source-trial requires manifest, resource manifest, exact approved SHA-256 digest and output",
    );
  }

  const common = {
    source: source as FrenchTrialSource,
    manifestPath,
    resourceManifestPath,
    approvedManifestDigest,
    outputPath,
  };
  if (type === "preview") {
    const responsePath = values.get("--response");
    if (!responsePath) {
      throw new Error(
        "french-source-trial preview requires --response and never performs network access",
      );
    }
    return { type, ...common, responsePath };
  }
  if (values.has("--response")) {
    throw new Error("french-source-trial run rejects response fixtures");
  }
  return { type: "run", ...common };
}

export async function runFrenchSourceTrialCli(
  command: FrenchSourceTrialCliCommand,
  environment: NodeJS.ProcessEnv,
): Promise<FrenchSourceTrialPreview> {
  const manifest = await readSourceTrialManifest(command.manifestPath);
  const resourceDocument = JSON.parse(
    await readFile(resolve(command.resourceManifestPath), "utf8"),
  );
  const approvedManifestDigests = [command.approvedManifestDigest];

  if (command.type === "preview") {
    const fixture = await readFile(resolve(command.responsePath), "utf8");
    let result: FrenchSourceTrialPreview;
    if (command.source === "csp") {
      result = await previewCspSourceTrial({
            manifest,
            resourceManifest:
              parseCspTrialResourceManifest(resourceDocument),
            approvedManifestDigests,
            fetch: async () => fixtureResponse(fixture, "text/csv"),
          });
    } else if (command.source === "bpce") {
      result = await previewBpceSourceTrial({
        manifest,
        resourceManifest: parseBpceTrialResourceManifest(resourceDocument),
        approvedManifestDigests,
        fetch: async () => fixtureResponse(fixture, "application/json"),
      });
    } else {
      result = await previewDataGouvSourceTrial({
            manifest,
            resourceManifest:
              parseDataGouvTrialResourceManifest(resourceDocument),
            approvedManifestDigests,
            fetch: async () =>
              fixtureResponse(fixture, "application/json"),
          });
    }
    await writeOutput(command.outputPath, result);
    return result;
  }

  const databaseUrl = environment.SOURCE_TRIAL_DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "SOURCE_TRIAL_DATABASE_URL is required for a policy-gated evidence run",
    );
  }
  const repository = new PostgresSourceTrialEvidenceRepository(
    createDatabase(databaseUrl, { max: 2 }),
  );
  try {
    let result: FrenchSourceTrialPreview;
    if (command.source === "csp") {
      result = await persistCspSourceTrial({
            manifest,
            resourceManifest:
              parseCspTrialResourceManifest(resourceDocument),
            approvedManifestDigests,
            repository,
          });
    } else if (command.source === "bpce") {
      result = await persistBpceSourceTrial({
        manifest,
        resourceManifest: parseBpceTrialResourceManifest(resourceDocument),
        approvedManifestDigests,
        repository,
      });
    } else {
      result = await persistDataGouvSourceTrial({
            manifest,
            resourceManifest:
              parseDataGouvTrialResourceManifest(resourceDocument),
            approvedManifestDigests,
            repository,
          });
    }
    await writeOutput(command.outputPath, result);
    return result;
  } finally {
    await repository.close();
  }
}

async function readSourceTrialManifest(
  path: string,
): Promise<SourceTrialManifest> {
  return sourceTrialManifestSchema.parse(
    JSON.parse(await readFile(resolve(path), "utf8")),
  );
}

function fixtureResponse(body: string, contentType: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-length": String(Buffer.byteLength(body, "utf8")),
    },
  });
}

async function writeOutput(path: string, value: unknown): Promise<void> {
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`);
}

if (import.meta.main) {
  const command = parseFrenchSourceTrialArgs(process.argv.slice(2));
  const result = await runFrenchSourceTrialCli(command, process.env);
  console.log(JSON.stringify({
    source: command.source,
    runId: result.runId,
    output: command.outputPath,
    canonicalWrites: false,
    sourceActivationChanges: false,
  }));
}
