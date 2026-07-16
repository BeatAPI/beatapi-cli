import { readFile } from "node:fs/promises";
import { BeatAPIClient } from "./client.mjs";

const VERSION = "0.1.0";

const HELP = `BeatAPI CLI ${VERSION}

Usage:
  beatapi workflows
  beatapi usage
  beatapi file upload <path>
  beatapi music-video create --json <path>
  beatapi ecommerce-video create --json <path>
  beatapi task get <task-id>
  beatapi task wait <task-id> [--interval <ms>] [--attempts <count>]

Environment:
  BEATAPI_API_KEY   Required for authenticated commands
  BEATAPI_BASE_URL  Optional; defaults to https://api.beatapi.io
`;

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function positiveInteger(value, fallback, flag) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

async function readJson(path) {
  if (!path) {
    throw new Error("--json <path> is required.");
  }
  return JSON.parse(await readFile(path, "utf8"));
}

function printJson(value, stdout) {
  stdout(`${JSON.stringify(value, null, 2)}\n`);
}

export async function run(
  args,
  {
    client = new BeatAPIClient(),
    stdout = (text) => process.stdout.write(text),
    stderr = (text) => process.stderr.write(text),
  } = {},
) {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    stdout(HELP);
    return;
  }

  if (args.includes("--version") || args.includes("-v")) {
    stdout(`${VERSION}\n`);
    return;
  }

  const [resource, action, identifier] = args;

  if (resource === "workflows" && !action) {
    printJson(await client.listWorkflows(), stdout);
    return;
  }

  if (resource === "usage" && !action) {
    printJson(await client.getUsage(), stdout);
    return;
  }

  if (resource === "file" && action === "upload" && identifier) {
    printJson(await client.uploadFile(identifier), stdout);
    return;
  }

  if (resource === "music-video" && action === "create") {
    const input = await readJson(valueAfter(args, "--json"));
    printJson(await client.createMusicVideoTask(input), stdout);
    return;
  }

  if (resource === "ecommerce-video" && action === "create") {
    const input = await readJson(valueAfter(args, "--json"));
    printJson(await client.createEcommerceVideoTask(input), stdout);
    return;
  }

  if (resource === "task" && action === "get" && identifier) {
    printJson(await client.getTask(identifier), stdout);
    return;
  }

  if (resource === "task" && action === "wait" && identifier) {
    const intervalMs = positiveInteger(
      valueAfter(args, "--interval"),
      5_000,
      "--interval",
    );
    const maxAttempts = positiveInteger(
      valueAfter(args, "--attempts"),
      120,
      "--attempts",
    );

    const task = await client.waitForTask(identifier, {
      intervalMs,
      maxAttempts,
      onUpdate: (update, attempt) => {
        stderr(
          `[${attempt}/${maxAttempts}] ${update.id || identifier}: ${update.status}\n`,
        );
      },
    });
    printJson(task, stdout);
    return;
  }

  throw new Error(`Unknown command.\n\n${HELP}`);
}
