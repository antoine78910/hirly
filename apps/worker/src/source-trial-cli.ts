import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  sourceTrialManifestSchema,
  type CanonicalJob,
  type SourceTrialManifest,
  type SourceTrialResult,
} from "@hirly/contracts";
import {
  createDatabase,
  type Database,
} from "@hirly/db";
import {
  persistAtsSourceTrial,
  previewAtsSourceTrial,
  type SourceTrialEvidenceRepository,
  type SourceTrialPreview,
} from "./source-trial";
import type { LeverTrialRegion } from "./providers/lever";

type TrialCliCommand =
  | {
      type: "preview";
      manifestPath: string;
      responsePath: string;
      outputPath: string;
      leverRegion: LeverTrialRegion;
    }
  | {
      type: "run";
      manifestPath: string;
      outputPath: string;
      leverRegion: LeverTrialRegion;
    };

export function parseSourceTrialArgs(args: string[]): TrialCliCommand {
  const [type, ...rest] = args;
  if (type !== "preview" && type !== "run") {
    throw new Error(
      "usage: source-trial <preview|run> --manifest <path> [--response <path>] --output <path> [--lever-region <global|eu>]",
    );
  }
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (
      !["--manifest", "--response", "--output", "--lever-region"].includes(name) ||
      !value ||
      value.startsWith("--")
    ) {
      throw new Error(`invalid source-trial argument: ${name ?? "missing"}`);
    }
    if (values.has(name)) throw new Error(`duplicate source-trial argument: ${name}`);
    values.set(name, value);
  }
  const manifestPath = values.get("--manifest");
  const outputPath = values.get("--output");
  const leverRegion = values.get("--lever-region") ?? "global";
  if (!manifestPath || !outputPath || !["global", "eu"].includes(leverRegion)) {
    throw new Error("source-trial requires manifest/output and a valid Lever region");
  }
  if (type === "preview") {
    const responsePath = values.get("--response");
    if (!responsePath) {
      throw new Error("source-trial preview requires --response and never performs network access");
    }
    return {
      type,
      manifestPath,
      responsePath,
      outputPath,
      leverRegion: leverRegion as LeverTrialRegion,
    };
  }
  if (values.has("--response")) {
    throw new Error("source-trial run rejects response fixtures");
  }
  return {
    type,
    manifestPath,
    outputPath,
    leverRegion: leverRegion as LeverTrialRegion,
  };
}

export class PostgresSourceTrialEvidenceRepository
  implements SourceTrialEvidenceRepository
{
  constructor(private readonly sql: Database) {}

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }

  async beginSourceTrial(manifest: SourceTrialManifest): Promise<string> {
    const [row] = await this.sql<{ run_id: string }[]>`
      SELECT worker_private.begin_source_trial(
        ${this.sql.json(asJson(manifest))}
      ) AS run_id
    `;
    if (!row) throw new Error("begin_source_trial returned no run");
    return row.run_id;
  }

  async recordSourceTrialPage(input: {
    runId: string;
    pageNumber: number;
    fetchedAt: Date;
    contentHash: string;
    byteCount: number;
    payload: unknown;
  }): Promise<string> {
    const [row] = await this.sql<{ page_id: string }[]>`
      SELECT worker_private.record_source_trial_page(
        ${input.runId}::uuid,
        ${input.pageNumber},
        ${input.fetchedAt},
        ${this.sql.json(asJson(input.payload))}
      ) AS page_id
    `;
    if (!row) throw new Error("record_source_trial_page returned no page");
    return row.page_id;
  }

  async recordSourceTrialCandidate(input: {
    runId: string;
    pageId: string;
    candidateKey: string;
    contentHash: string;
    candidate: CanonicalJob;
  }): Promise<void> {
    await this.sql`
      SELECT worker_private.record_source_trial_candidate(
        ${input.runId}::uuid,
        ${input.pageId}::uuid,
        ${input.candidateKey},
        ${this.sql.json(asJson(input.candidate))}
      )
    `;
  }

  async recordSourceTrialScorecard(input: {
    runId: string;
    scorecardKey: string;
    result: SourceTrialResult;
  }): Promise<void> {
    await this.sql`
      SELECT worker_private.record_source_trial_scorecard(
        ${input.runId}::uuid,
        ${input.scorecardKey},
        ${this.sql.json(asJson(input.result))}
      )
    `;
  }
}

export async function runSourceTrialCli(
  command: TrialCliCommand,
  environment: NodeJS.ProcessEnv,
): Promise<SourceTrialPreview> {
  const manifest = sourceTrialManifestSchema.parse(
    JSON.parse(await readFile(resolve(command.manifestPath), "utf8")),
  );
  if (command.type === "preview") {
    const response = JSON.parse(
      await readFile(resolve(command.responsePath), "utf8"),
    );
    const preview = await previewAtsSourceTrial({
      manifest,
      leverRegion: command.leverRegion,
      fetch: async () => Response.json(response),
    });
    await writeOutput(command.outputPath, preview);
    return preview;
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
    const result = await persistAtsSourceTrial({
      manifest,
      repository,
      leverRegion: command.leverRegion,
    });
    await writeOutput(command.outputPath, result);
    return result;
  } finally {
    await repository.close();
  }
}

function asJson(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

async function writeOutput(path: string, value: unknown): Promise<void> {
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`);
}

if (import.meta.main) {
  const command = parseSourceTrialArgs(process.argv.slice(2));
  const result = await runSourceTrialCli(command, process.env);
  console.log(JSON.stringify({
    runId: result.runId,
    output: command.outputPath,
    canonicalWrites: false,
  }));
}
