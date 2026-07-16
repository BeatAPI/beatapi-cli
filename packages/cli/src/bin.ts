#!/usr/bin/env node

import { BeatAPIError } from "beatapi-client";

import { run } from "./cli.js";

function exitCodeFor(error: unknown): number {
  if (!(error instanceof BeatAPIError)) return 1;
  if (error.status === 401 || error.code === "missing_api_key") return 2;
  if (error.status === 402 || error.code === "insufficient_credits") return 3;
  if (error.status === 429) return 4;
  return 1;
}

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`beatapi: ${message}\n`);
  process.exitCode = exitCodeFor(error);
}
