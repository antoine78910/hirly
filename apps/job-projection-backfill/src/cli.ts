import { readFile, writeFile } from "node:fs/promises";
import { createDatabase } from "@hirly/db";
import {
  JOB_PROJECTION_BACKFILL_CHECKPOINT_VERSION,
  runProjectionBackfill,
  type ProjectionBackfillCheckpoint,
} from "./backfill";
import { PostgresProjectionBackfillRepository } from "./repository";

function valuesAfter(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`missing_value:${flag}`);
      values.push(value);
      index += 1;
    }
  }
  return values;
}

function valueAfter(argv: string[], flag: string): string | undefined {
  const values = valuesAfter(argv, flag);
  if (values.length > 1) throw new Error(`duplicate_flag:${flag}`);
  return values[0];
}

export interface ProjectionBackfillCommand {
  execute: boolean;
  batchSize: number;
  cursor: string | null;
  checkpointPath?: string;
  checkpointOutPath?: string;
  countryCode?: string;
  provider?: string;
  role?: string;
  rollbackDenylist: string[];
}

export function parseProjectionBackfillArgs(argv: string[]): ProjectionBackfillCommand {
  const batchValue = valueAfter(argv, "--batch-size");
  return {
    execute: argv.includes("--execute"),
    batchSize: batchValue === undefined ? 100 : Number(batchValue),
    cursor: valueAfter(argv, "--cursor") ?? null,
    checkpointPath: valueAfter(argv, "--checkpoint"),
    checkpointOutPath: valueAfter(argv, "--checkpoint-out"),
    countryCode: valueAfter(argv, "--country"),
    provider: valueAfter(argv, "--provider"),
    role: valueAfter(argv, "--role"),
    rollbackDenylist: valuesAfter(argv, "--deny-provider-country"),
  };
}

export async function runProjectionBackfillCli(argv: string[]): Promise<void> {
  const command = parseProjectionBackfillArgs(argv);
  if (
    command.execute &&
    process.env.HIRLY_JOB_PROJECTION_BACKFILL_ACK !== "ENQUEUE_BOUNDED_PROJECTION_TASKS"
  ) {
    throw new Error("execute_requires_operator_acknowledgement");
  }
  const databaseUrl = process.env.HIRLY_JOB_PROJECTION_BACKFILL_DATABASE_URL;
  if (!databaseUrl) throw new Error("missing_backfill_database_url");
  const fromFile = command.checkpointPath
    ? (JSON.parse(await readFile(command.checkpointPath, "utf8")) as ProjectionBackfillCheckpoint)
    : null;
  if (fromFile && command.cursor) throw new Error("checkpoint_and_cursor_are_mutually_exclusive");
  const checkpoint = fromFile ?? {
    schemaVersion: JOB_PROJECTION_BACKFILL_CHECKPOINT_VERSION,
    cursor: command.cursor,
  };
  const sql = createDatabase(databaseUrl, { max: 1 });
  try {
    const progress = await runProjectionBackfill({
      repository: new PostgresProjectionBackfillRepository(sql),
      execute: command.execute,
      batchSize: command.batchSize,
      checkpoint,
      scope: {
        ...(command.countryCode ? { countryCode: command.countryCode } : {}),
        ...(command.provider ? { provider: command.provider } : {}),
        ...(command.role ? { role: command.role } : {}),
      },
      rollbackDenylist: command.rollbackDenylist,
    });
    if (command.checkpointOutPath) {
      await writeFile(
        command.checkpointOutPath,
        `${JSON.stringify(progress.checkpoint, null, 2)}\n`,
      );
    }
    console.log(JSON.stringify(progress));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const direct = import.meta.main;
if (direct) await runProjectionBackfillCli(Bun.argv.slice(2));
