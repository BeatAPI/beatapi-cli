import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";

import {
  BeatAPIClient,
  type BeatAPITask,
  type CreateWebhookInput,
  type CreateRealtimeSessionInput,
  type EcommerceVideoTaskInput,
  type MusicVideoTaskInput,
  type UpdateWebhookInput,
} from "beatapi-client";

import {
  createCredentialStore,
  resolveApiKey,
  type CredentialStore,
} from "./credentials.js";
import { promptSecret as defaultPromptSecret } from "./prompt.js";
import { persistWebhookSecret } from "./webhook-secrets.js";
import { runCapabilities, type CapabilityClient } from './capabilities.js';

export const VERSION = "0.3.0";

const HELP = `BeatAPI CLI ${VERSION}

Usage:
  beatapi capabilities search [--query <text>] [--kind <model|data|workflow>] [--platform <name>] [--limit <1-50>] [--cursor <cursor>]
  beatapi capabilities inspect <reference>
  beatapi capabilities run <reference> --file <input.json> [--idempotency-key <key>]
  beatapi capabilities status <reference> <task-id> [--wait] [--interval <ms>] [--attempts <count>]
  All capabilities commands accept --output <new-file.json> (never overwrites).
  beatapi auth login|status|logout
  beatapi workflows list
  beatapi usage
  beatapi files upload <path>
  beatapi music-video create --file <input.json>
  beatapi music-video shots edit <task-id> <shot-id> --prompt <text>
  beatapi music-video shots media <task-id> <shot-id>
  beatapi music-video compose <task-id> --shot <shot-id> [--shot <shot-id>]
  beatapi ecommerce-video create --file <input.json>
  beatapi realtime sessions create --duration <15|60|300> --origin <url> [--origin <url>]
  beatapi realtime sessions get <session-id>
  beatapi realtime sessions close <session-id>
  beatapi tasks get <task-id>
  beatapi tasks wait <task-id> [--interval <ms>] [--attempts <count>]
  beatapi webhooks list
  beatapi webhooks create --file <input.json>
  beatapi webhooks get <webhook-id>
  beatapi webhooks update <webhook-id> --file <input.json>
  beatapi webhooks delete <webhook-id>

Authentication:
  Run \`beatapi auth login\` to store the key in the operating-system
  credential manager, or set BEATAPI_API_KEY for the current process.

Environment:
  BEATAPI_API_KEY   Overrides the saved credential
  BEATAPI_BASE_URL  Optional API origin; defaults to https://api.beatapi.io
`;

type Writable = (text: string) => void;

interface ClientLike extends Partial<CapabilityClient> {
  listWorkflows(): Promise<unknown>;
  getUsage(): Promise<unknown>;
  getTask(taskId: string): Promise<unknown>;
  waitForTask(
    taskId: string,
    options: {
      intervalMs: number;
      maxAttempts: number;
      onUpdate: (task: BeatAPITask, attempt: number) => void;
    },
  ): Promise<unknown>;
  uploadFile(
    content: Blob | Uint8Array,
    options: { filename: string; mimeType?: string; purpose?: "input" },
  ): Promise<unknown>;
  createMusicVideoTask(input: MusicVideoTaskInput): Promise<unknown>;
  editMusicVideoShot(
    taskId: string,
    shotId: string,
    input: { prompt: string; duration?: number; quality?: "standard" | "high"; resolution?: "540p" | "720p" | "1080p" },
  ): Promise<unknown>;
  getMusicVideoShotMedia(taskId: string, shotId: string): Promise<unknown>;
  composeMusicVideoTask(
    taskId: string,
    input: { shot_ids: string[] },
  ): Promise<unknown>;
  createEcommerceVideoTask(input: EcommerceVideoTaskInput): Promise<unknown>;
  createRealtimeSession(
    input: CreateRealtimeSessionInput,
    options: { idempotencyKey: string },
  ): Promise<unknown>;
  getRealtimeSession(id: string): Promise<unknown>;
  closeRealtimeSession(id: string): Promise<unknown>;
  listWebhooks(): Promise<unknown>;
  createWebhook(input: CreateWebhookInput): Promise<unknown>;
  getWebhook(id: string): Promise<unknown>;
  updateWebhook(id: string, input: UpdateWebhookInput): Promise<unknown>;
  deleteWebhook(id: string): Promise<unknown>;
}

export interface RunOptions {
  stdout?: Writable;
  stderr?: Writable;
  env?: Record<string, string | undefined>;
  apiKey?: string;
  credentialStore?: CredentialStore;
  promptSecret?: (label?: string) => Promise<string>;
  createClient?: (apiKey?: string) => ClientLike;
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".aac": "audio/aac",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".srt": "application/x-subrip",
  ".wav": "audio/wav",
  ".webp": "image/webp",
};

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function repeatedFlagValues(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }
    values.push(value);
    index += 1;
  }
  return values;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  flag: string,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function realtimeDuration(value: string | undefined): 15 | 60 | 300 {
  const parsed = Number(value);
  if (parsed !== 15 && parsed !== 60 && parsed !== 300) {
    throw new Error("--duration must be 15, 60, or 300 seconds.");
  }
  return parsed;
}

function metadataValues(args: string[]): Record<string, string> | undefined {
  const entries = repeatedFlagValues(args, "--metadata").map((entry) => {
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      throw new Error("--metadata values must use key=value syntax.");
    }
    return [entry.slice(0, separator), entry.slice(separator + 1)] as const;
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

async function readJson<T>(path: string | undefined): Promise<T> {
  if (!path) throw new Error("--file <path> is required.");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Unable to read ${path}.`, { cause: error });
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`${path} is not valid JSON.`, { cause: error });
  }
}

function inputFile(args: string[]): string | undefined {
  return flagValue(args, "--file") ?? flagValue(args, "--json");
}

function printJson(value: unknown, stdout: Writable): void {
  stdout(`${JSON.stringify(value, null, 2)}\n`);
}

function requireIdentifier(value: string | undefined, label: string): string {
  if (!value || value.startsWith("--")) throw new Error(`${label} is required.`);
  return value;
}

function defaultCreateClient(
  apiKey: string | undefined,
  env: Record<string, string | undefined>,
): ClientLike {
  return new BeatAPIClient({
    apiKey,
    baseUrl: env.BEATAPI_BASE_URL,
    allowInsecureLocalhost: env.BEATAPI_ALLOW_INSECURE_LOCALHOST === "1",
    trustCustomBaseUrl: env.BEATAPI_TRUST_CUSTOM_BASE_URL === "1",
  });
}

export async function run(
  args: string[],
  options: RunOptions = {},
): Promise<number> {
  const stdout = options.stdout ?? ((text) => process.stdout.write(text));
  const stderr = options.stderr ?? ((text) => process.stderr.write(text));
  const env = options.env ?? process.env;
  const store = options.credentialStore ?? createCredentialStore();
  const createClient =
    options.createClient ?? ((apiKey) => defaultCreateClient(apiKey, env));
  const promptSecret = options.promptSecret ?? defaultPromptSecret;

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    stdout(HELP);
    return 0;
  }
  if (args.includes("--version") || args.includes("-v")) {
    stdout(`${VERSION}\n`);
    return 0;
  }

  const [resource, action, firstIdentifier, secondIdentifier] = args;
  if(resource==='capabilities' && (action==='search'||action==='inspect')) {
    return runCapabilities(args.slice(1),createClient(undefined) as CapabilityClient,stdout,stderr);
  }

  if (resource === "auth" && action === "login") {
    const apiKey = (await promptSecret()).trim();
    if (!apiKey.startsWith("sk_") || apiKey.length < 8) {
      throw new Error("The API key must be a BeatAPI key beginning with sk_.");
    }
    const usage = await createClient(apiKey).getUsage();
    await store.set(apiKey);
    stdout("Connected to BeatAPI. The API key was saved securely.\n");
    printJson(usage, stdout);
    return 0;
  }

  if (resource === "auth" && action === "logout") {
    await store.delete();
    stdout("Saved BeatAPI credentials removed.\n");
    return 0;
  }

  if (
    (resource === "workflows" && (action === undefined || action === "list")) ||
    (resource === "workflow" && action === "list")
  ) {
    printJson(await createClient(undefined).listWorkflows(), stdout);
    return 0;
  }

  const resolved =
    options.apiKey?.trim()
      ? { apiKey: options.apiKey.trim(), source: "explicit" as const }
      : await resolveApiKey({ env, store });

  if (resource === "auth" && action === "status") {
    if (!resolved) {
      stdout("Not authenticated. Run `beatapi auth login`.\n");
      return 1;
    }
    const usage = await createClient(resolved.apiKey).getUsage();
    stdout(`Authenticated via ${resolved.source}.\n`);
    printJson(usage, stdout);
    return 0;
  }

  if (!resolved) {
    throw new Error(
      "Authentication required. Run `beatapi auth login` or set BEATAPI_API_KEY.",
    );
  }
  const client = createClient(resolved.apiKey);
  if(resource==='capabilities') return runCapabilities(args.slice(1),client as CapabilityClient,stdout,stderr);

  if (resource === "usage" && action === undefined) {
    printJson(await client.getUsage(), stdout);
    return 0;
  }

  if (
    (resource === "files" || resource === "file") &&
    action === "upload"
  ) {
    const path = requireIdentifier(firstIdentifier, "File path");
    const extension = extname(path).toLowerCase();
    const mimeType = MIME_TYPES[extension];
    if (!mimeType) {
      throw new Error(`Unsupported file extension: ${extension || "(none)"}.`);
    }
    const content = await readFile(path);
    printJson(
      await client.uploadFile(content, {
        filename: basename(path),
        mimeType,
        purpose: "input",
      }),
      stdout,
    );
    return 0;
  }

  if (resource === "music-video" && action === "create") {
    const input = await readJson<MusicVideoTaskInput>(inputFile(args));
    printJson(await client.createMusicVideoTask(input), stdout);
    return 0;
  }

  if (
    resource === "music-video" &&
    action === "shots" &&
    firstIdentifier === "edit"
  ) {
    const taskId = requireIdentifier(secondIdentifier, "Task ID");
    const shotId = requireIdentifier(args[4], "Shot ID");
    const prompt = flagValue(args, "--prompt");
    const input = inputFile(args)
      ? await readJson<{
          prompt: string;
          duration?: number;
          quality?: "standard" | "high";
          resolution?: "540p" | "720p" | "1080p";
        }>(inputFile(args))
      : { prompt: requireIdentifier(prompt, "--prompt") };
    printJson(await client.editMusicVideoShot(taskId, shotId, input), stdout);
    return 0;
  }

  if (
    resource === "music-video" &&
    action === "shots" &&
    firstIdentifier === "media"
  ) {
    const taskId = requireIdentifier(secondIdentifier, "Task ID");
    const shotId = requireIdentifier(args[4], "Shot ID");
    printJson(await client.getMusicVideoShotMedia(taskId, shotId), stdout);
    return 0;
  }

  if (resource === "music-video" && action === "compose") {
    const taskId = requireIdentifier(firstIdentifier, "Task ID");
    const shotIds = repeatedFlagValues(args, "--shot");
    if (shotIds.length === 0) {
      throw new Error("At least one --shot <shot-id> is required.");
    }
    printJson(
      await client.composeMusicVideoTask(taskId, { shot_ids: shotIds }),
      stdout,
    );
    return 0;
  }

  if (resource === "ecommerce-video" && action === "create") {
    const input = await readJson<EcommerceVideoTaskInput>(inputFile(args));
    printJson(await client.createEcommerceVideoTask(input), stdout);
    return 0;
  }

  if (
    resource === "realtime" &&
    action === "sessions" &&
    firstIdentifier === "create"
  ) {
    const allowedOrigins = repeatedFlagValues(args, "--origin");
    if (allowedOrigins.length === 0) {
      throw new Error("At least one --origin <url> is required.");
    }
    const metadata = metadataValues(args);
    const input: CreateRealtimeSessionInput = {
      max_duration_seconds: realtimeDuration(flagValue(args, "--duration")),
      allowed_origins: allowedOrigins,
      ...(metadata ? { metadata } : {}),
    };
    printJson(
      await client.createRealtimeSession(input, {
        idempotencyKey:
          flagValue(args, "--idempotency-key") ?? randomUUID(),
      }),
      stdout,
    );
    return 0;
  }

  if (
    resource === "realtime" &&
    action === "sessions" &&
    firstIdentifier === "get"
  ) {
    printJson(
      await client.getRealtimeSession(
        requireIdentifier(secondIdentifier, "Session ID"),
      ),
      stdout,
    );
    return 0;
  }

  if (
    resource === "realtime" &&
    action === "sessions" &&
    firstIdentifier === "close"
  ) {
    printJson(
      await client.closeRealtimeSession(
        requireIdentifier(secondIdentifier, "Session ID"),
      ),
      stdout,
    );
    return 0;
  }

  if (
    (resource === "tasks" || resource === "task") &&
    action === "get"
  ) {
    printJson(
      await client.getTask(requireIdentifier(firstIdentifier, "Task ID")),
      stdout,
    );
    return 0;
  }

  if (
    (resource === "tasks" || resource === "task") &&
    action === "wait"
  ) {
    const taskId = requireIdentifier(firstIdentifier, "Task ID");
    const intervalMs = positiveInteger(
      flagValue(args, "--interval"),
      5_000,
      "--interval",
    );
    const maxAttempts = positiveInteger(
      flagValue(args, "--attempts"),
      120,
      "--attempts",
    );
    const result = await client.waitForTask(taskId, {
      intervalMs,
      maxAttempts,
      onUpdate: (task, attempt) => {
        stderr(
          `[${attempt}/${maxAttempts}] ${task.id || taskId}: ${task.status}\n`,
        );
      },
    });
    printJson(result, stdout);
    return 0;
  }

  if (resource === "webhooks" && action === "list") {
    printJson(await client.listWebhooks(), stdout);
    return 0;
  }
  if (resource === "webhooks" && action === "create") {
    const input = await readJson<CreateWebhookInput>(inputFile(args));
    const endpoint = (await client.createWebhook(input)) as Record<
      string,
      unknown
    >;
    try {
      printJson(await persistWebhookSecret(endpoint, env), stdout);
    } catch (error) {
      const endpointId =
        typeof endpoint.id === "string" ? endpoint.id : undefined;
      if (endpointId) {
        await client.deleteWebhook(endpointId).catch(() => undefined);
      }
      throw new Error(
        "Unable to store the one-time webhook secret; the webhook was rolled back.",
        { cause: error },
      );
    }
    return 0;
  }
  if (resource === "webhooks" && action === "get") {
    printJson(
      await client.getWebhook(requireIdentifier(firstIdentifier, "Webhook ID")),
      stdout,
    );
    return 0;
  }
  if (resource === "webhooks" && action === "update") {
    const id = requireIdentifier(firstIdentifier, "Webhook ID");
    const input = await readJson<UpdateWebhookInput>(inputFile(args));
    printJson(await client.updateWebhook(id, input), stdout);
    return 0;
  }
  if (resource === "webhooks" && action === "delete") {
    printJson(
      await client.deleteWebhook(
        requireIdentifier(firstIdentifier, "Webhook ID"),
      ),
      stdout,
    );
    return 0;
  }

  throw new Error(`Unknown command.\n\n${HELP}`);
}
