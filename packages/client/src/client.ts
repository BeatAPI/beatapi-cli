import { BeatAPIError } from "./errors.js";
import type { components, operations } from "./types.generated.js";

export type BeatAPIWorkflow = components["schemas"]["Workflow"];
export type BeatAPITaskStatus = components["schemas"]["TaskStatus"];
export type BeatAPITask = components["schemas"]["Task"];
export type BeatAPIUsage = components["schemas"]["Usage"];
export type BeatAPIFile = components["schemas"]["File"];
export type BeatAPIShotMedia = components["schemas"]["ShotMedia"];
export type BeatAPIWebhook = components["schemas"]["WebhookEndpoint"];
export type BeatAPIDeleteResult = components["schemas"]["DeleteResponse"]["data"];

export type MusicVideoTaskInput =
  operations["createMusicVideoTask"]["requestBody"]["content"]["application/json"];
export type MusicVideoShotEditInput =
  operations["editMusicVideoShot"]["requestBody"]["content"]["application/json"];
export type MusicVideoComposeInput =
  operations["composeMusicVideoTask"]["requestBody"]["content"]["application/json"];
export type EcommerceVideoTaskInput =
  operations["createEcommerceVideoTask"]["requestBody"]["content"]["application/json"];
export type CreateWebhookInput =
  operations["createWebhookEndpoint"]["requestBody"]["content"]["application/json"];
export type UpdateWebhookInput =
  operations["updateWebhookEndpoint"]["requestBody"]["content"]["application/json"];

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface BeatAPIClientOptions {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  fetch?: FetchLike | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  random?: (() => number) | undefined;
}

interface RequestOptions {
  method?: string | undefined;
  body?: unknown | undefined;
  authenticated?: boolean | undefined;
  retry?: RetryOptions | undefined;
}

export interface WaitForTaskOptions {
  intervalMs?: number;
  maxAttempts?: number;
  onUpdate?: (task: BeatAPITask, attempt: number) => void;
}

export interface UploadFileOptions {
  filename: string;
  mimeType?: string;
  purpose?: "input";
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    request_id?: string;
    retry_after_seconds?: number;
    details?: unknown;
  };
}

const ACTIONABLE_OR_TERMINAL_STATUSES = new Set<BeatAPITaskStatus>([
  "storyboard_ready",
  "requires_action",
  "succeeded",
  "failed",
]);

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}

function retryAfterFromHeaders(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;

  const date = Date.parse(raw);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1_000));
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function errorFromResponse(
  response: Response,
  payload: unknown,
): BeatAPIError {
  const envelope =
    typeof payload === "object" && payload !== null
      ? (payload as ErrorEnvelope)
      : {};
  const error = envelope.error;
  const retryAfterSeconds =
    error?.retry_after_seconds ?? retryAfterFromHeaders(response.headers);

  return new BeatAPIError(
    error?.message || `BeatAPI request failed with HTTP ${response.status}.`,
    {
      status: response.status,
      code: error?.code,
      requestId: error?.request_id,
      retryAfterSeconds,
      details: error?.details,
    },
  );
}

function unwrapData<T>(payload: unknown): T {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !Object.hasOwn(payload, "data")
  ) {
    throw new BeatAPIError("BeatAPI returned an invalid response envelope.", {
      code: "invalid_response",
      details: payload,
    });
  }
  return (payload as { data: T }).data;
}

function encodePathSegment(value: string): string {
  if (!value) throw new TypeError("Path identifiers must not be empty.");
  return encodeURIComponent(value);
}

export class BeatAPIClient {
  readonly apiKey: string | undefined;
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: BeatAPIClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || "https://api.beatapi.io").replace(
      /\/+$/,
      "",
    );
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error("A Fetch API implementation is required.");
    }
    this.fetchImpl = fetchImpl.bind(globalThis);
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = options.random ?? Math.random;
  }

  private async request<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const method = options.method ?? "GET";
    const authenticated = options.authenticated ?? true;
    if (authenticated && !this.apiKey) {
      throw new BeatAPIError(
        "A BeatAPI API key is required. Run `beatapi auth login` or set BEATAPI_API_KEY.",
        { code: "missing_api_key" },
      );
    }

    const maxAttempts = options.retry?.maxAttempts ?? 1;
    const baseDelayMs = options.retry?.baseDelayMs ?? 500;
    const maxDelayMs = options.retry?.maxDelayMs ?? 10_000;
    assertPositiveInteger(maxAttempts, "retry.maxAttempts");
    assertPositiveInteger(baseDelayMs, "retry.baseDelayMs");
    assertPositiveInteger(maxDelayMs, "retry.maxDelayMs");

    const headers = new Headers({ accept: "application/json" });
    if (authenticated) headers.set("authorization", `Bearer ${this.apiKey}`);

    let body: BodyInit | undefined;
    if (options.body instanceof FormData) {
      body = options.body;
    } else if (options.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(options.body);
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers,
          ...(body === undefined ? {} : { body }),
        });
        const payload = await readPayload(response);

        if (response.ok) return unwrapData<T>(payload);

        const error = errorFromResponse(response, payload);
        if (
          attempt >= maxAttempts ||
          !RETRYABLE_STATUS_CODES.has(response.status) ||
          error.code === "user_concurrency_exceeded"
        ) {
          throw error;
        }

        const serverDelay =
          error.retryAfterSeconds === undefined
            ? undefined
            : error.retryAfterSeconds * 1_000;
        const exponentialDelay = Math.min(
          maxDelayMs,
          baseDelayMs * 2 ** (attempt - 1),
        );
        const delay =
          serverDelay ??
          Math.round(exponentialDelay * (1 + this.random() * 0.2));
        await this.sleep(Math.min(maxDelayMs, delay));
      } catch (error) {
        if (error instanceof BeatAPIError) throw error;
        if (attempt >= maxAttempts) {
          throw new BeatAPIError("Unable to reach BeatAPI.", {
            code: "network_error",
            cause: error,
          });
        }
        const exponentialDelay = Math.min(
          maxDelayMs,
          baseDelayMs * 2 ** (attempt - 1),
        );
        await this.sleep(
          Math.round(exponentialDelay * (1 + this.random() * 0.2)),
        );
      }
    }

    throw new BeatAPIError("BeatAPI request exhausted its retry budget.", {
      code: "retry_exhausted",
    });
  }

  listWorkflows(): Promise<BeatAPIWorkflow[]> {
    return this.request<{ object: "list"; data: BeatAPIWorkflow[] }>(
      "/v1/workflows",
      { authenticated: false },
    ).then((result) => result.data);
  }

  getUsage(): Promise<BeatAPIUsage> {
    return this.request("/v1/usage");
  }

  getTask(
    taskId: string,
    options: { retry?: RetryOptions } = {},
  ): Promise<BeatAPITask> {
    return this.request(`/v1/tasks/${encodePathSegment(taskId)}`, {
      retry: options.retry,
    });
  }

  createMusicVideoTask(input: MusicVideoTaskInput): Promise<BeatAPITask> {
    return this.request("/v1/music-video/tasks", {
      method: "POST",
      body: input,
    });
  }

  editMusicVideoShot(
    taskId: string,
    shotId: string,
    input: MusicVideoShotEditInput,
  ): Promise<BeatAPITask> {
    return this.request(
      `/v1/music-video/tasks/${encodePathSegment(taskId)}/shots/${encodePathSegment(shotId)}/edit`,
      { method: "POST", body: input },
    );
  }

  getMusicVideoShotMedia(
    taskId: string,
    shotId: string,
  ): Promise<BeatAPIShotMedia> {
    return this.request(
      `/v1/music-video/tasks/${encodePathSegment(taskId)}/shots/${encodePathSegment(shotId)}/media`,
      { method: "POST" },
    );
  }

  composeMusicVideoTask(
    taskId: string,
    input: MusicVideoComposeInput,
  ): Promise<BeatAPITask> {
    return this.request(
      `/v1/music-video/tasks/${encodePathSegment(taskId)}/compose`,
      { method: "POST", body: input },
    );
  }

  createEcommerceVideoTask(
    input: EcommerceVideoTaskInput,
  ): Promise<BeatAPITask> {
    return this.request("/v1/ecommerce-video/tasks", {
      method: "POST",
      body: input,
    });
  }

  uploadFile(
    content: Blob | Uint8Array,
    options: UploadFileOptions,
  ): Promise<BeatAPIFile> {
    const blob =
      content instanceof Blob
        ? content
        : new Blob([Uint8Array.from(content).buffer], {
            type: options.mimeType || "application/octet-stream",
          });
    const form = new FormData();
    form.append("file", blob, options.filename);
    form.append("purpose", options.purpose ?? "input");
    return this.request("/v1/files", { method: "POST", body: form });
  }

  listWebhooks(): Promise<components["schemas"]["WebhookEndpointList"]> {
    return this.request("/v1/webhooks");
  }

  createWebhook(input: CreateWebhookInput): Promise<BeatAPIWebhook> {
    return this.request("/v1/webhooks", { method: "POST", body: input });
  }

  getWebhook(id: string): Promise<BeatAPIWebhook> {
    return this.request(`/v1/webhooks/${encodePathSegment(id)}`);
  }

  updateWebhook(
    id: string,
    input: UpdateWebhookInput,
  ): Promise<BeatAPIWebhook> {
    return this.request(`/v1/webhooks/${encodePathSegment(id)}`, {
      method: "PATCH",
      body: input,
    });
  }

  deleteWebhook(id: string): Promise<BeatAPIDeleteResult> {
    return this.request(`/v1/webhooks/${encodePathSegment(id)}`, {
      method: "DELETE",
    });
  }

  async waitForTask(
    taskId: string,
    options: WaitForTaskOptions = {},
  ): Promise<BeatAPITask> {
    const intervalMs = options.intervalMs ?? 5_000;
    const maxAttempts = options.maxAttempts ?? 120;
    assertPositiveInteger(intervalMs, "intervalMs");
    assertPositiveInteger(maxAttempts, "maxAttempts");

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const task = await this.getTask(taskId);
      options.onUpdate?.(task, attempt);
      if (ACTIONABLE_OR_TERMINAL_STATUSES.has(task.status)) return task;

      if (attempt < maxAttempts) {
        const jitter = Math.round(intervalMs * this.random() * 0.2);
        await this.sleep(intervalMs + jitter);
      }
    }

    throw new BeatAPIError(
      `Task ${taskId} did not reach a terminal or actionable state after ${maxAttempts} attempts.`,
      { code: "polling_timeout" },
    );
  }
}
