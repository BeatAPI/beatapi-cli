import { BeatAPIError } from "./errors.js";
import {
  assertCapabilityReference,
  type CapabilitySearchInput,
  type CapabilityPage,
  type CapabilityContract,
  type CapabilityView,
  type CapabilityResult,
} from "./capabilities.js";
import type { components, operations } from "./types.generated.js";

export type BeatAPIWorkflow = components["schemas"]["Workflow"];
export type BeatAPITextModel = components["schemas"]["TextModel"];
export type BeatAPITaskStatus = components["schemas"]["TaskStatus"];
export type BeatAPITask = components["schemas"]["Task"];
export type BeatAPIUsage = components["schemas"]["Usage"];
export type BeatAPIFile = components["schemas"]["File"];
export type BeatAPIShotMedia = components["schemas"]["ShotMedia"];
export type BeatAPIWebhook = components["schemas"]["WebhookEndpoint"];
export type BeatAPIRealtimeSession = components["schemas"]["RealtimeSession"];
export type BeatAPIGenerationModel = components["schemas"]["GenerationModel"];
export type BeatAPIEffect = components["schemas"]["Effect"];
export type BeatAPIDeleteResult =
  components["schemas"]["DeleteResponse"]["data"];

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
export type CreateRealtimeSessionInput =
  operations["createRealtimeSession"]["requestBody"]["content"]["application/json"];
export type TextResponseInput =
  operations["createTextResponse"]["requestBody"]["content"]["application/json"];
export type TextResponseOutput =
  components["schemas"]["TextPassthroughResponse"];
export type VideoAnalysisTaskInput =
  operations["createVideoAnalysisTask"]["requestBody"]["content"]["application/json"];
export type ImageGenerationTaskInput =
  operations["createImageGenerationTask"]["requestBody"]["content"]["application/json"];
export type VideoGenerationTaskInput =
  operations["createVideoGenerationTask"]["requestBody"]["content"]["application/json"];
export type CreateEffectTaskInput =
  operations["createEffectTask"]["requestBody"]["content"]["application/json"];

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
  allowInsecureLocalhost?: boolean | undefined;
  trustCustomBaseUrl?: boolean | undefined;
  clientDialect?: "mcp" | undefined;
  fetch?: FetchLike | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  random?: (() => number) | undefined;
}

interface RequestOptions {
  method?: string | undefined;
  body?: unknown | undefined;
  headers?: HeadersInit | undefined;
  authenticated?: boolean | undefined;
  responseShape?: "beatapi" | "raw" | undefined;
  retry?: RetryOptions | undefined;
  timeoutMs?: number;
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
    retryable?: boolean;
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

function validatedBaseUrl(
  value: string,
  options: Pick<
    BeatAPIClientOptions,
    "allowInsecureLocalhost" | "trustCustomBaseUrl"
  >,
): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("BeatAPI base URL must be an exact HTTPS origin.");
  }
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    parsed.hostname,
  );
  const insecureTestOrigin =
    options.allowInsecureLocalhost === true && isLoopback;
  if (
    (parsed.protocol !== "https:" && !insecureTestOrigin) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new TypeError(
      "BeatAPI base URL must be an exact HTTPS origin without credentials, path, query, or fragment.",
    );
  }
  if (
    parsed.origin !== "https://api.beatapi.io" &&
    !insecureTestOrigin &&
    options.trustCustomBaseUrl !== true
  ) {
    throw new TypeError(
      "A custom BeatAPI HTTPS origin requires an explicit trusted operator setting.",
    );
  }
  return parsed.origin;
}

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

function errorFromResponse(response: Response, payload: unknown): BeatAPIError {
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
      retryable: error?.retryable,
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
  private readonly clientDialect: "mcp" | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: BeatAPIClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = validatedBaseUrl(
      options.baseUrl || "https://api.beatapi.io",
      options,
    );
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error("A Fetch API implementation is required.");
    }
    this.clientDialect = options.clientDialect;
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
    if (this.clientDialect) headers.set("x-beat-client", this.clientDialect);
    if (authenticated) headers.set("authorization", `Bearer ${this.apiKey}`);
    for (const [name, value] of new Headers(options.headers)) {
      headers.set(name, value);
    }

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
          redirect: "error",
          ...(options.timeoutMs || path.startsWith("/v1/capabilities/")
            ? { signal: AbortSignal.timeout(options.timeoutMs ?? 35_000) }
            : {}),
          ...(body === undefined ? {} : { body }),
        });
        const payload = await readPayload(response);

        if (response.ok) {
          return options.responseShape === "raw"
            ? (payload as T)
            : unwrapData<T>(payload);
        }

        const error = errorFromResponse(response, payload);
        if (
          attempt >= maxAttempts ||
          !RETRYABLE_STATUS_CODES.has(response.status) ||
          error.retryable === false ||
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
        await this.sleep(delay);
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

  searchCapabilities(
    input: CapabilitySearchInput = {},
  ): Promise<CapabilityPage> {
    if (
      input.limit !== undefined &&
      (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50)
    )
      throw new TypeError("limit must be an integer from 1 to 50.");
    if (
      input.kind !== undefined &&
      !["model", "data", "workflow"].includes(input.kind)
    )
      throw new TypeError("Invalid capability kind.");
    return this.request("/v1/capabilities/search", {
      method: "POST",
      body: input,
      authenticated: false,
    });
  }

  inspectCapability(reference: string): Promise<CapabilityContract> {
    assertCapabilityReference(reference);
    return this.request("/v1/capabilities/inspect", {
      method: "POST",
      body: { reference },
      authenticated: false,
    });
  }

  runCapability(
    reference: string,
    input: Record<string, unknown>,
    options: CapabilityView & { idempotencyKey: string; retry?: RetryOptions },
  ): Promise<CapabilityResult> {
    assertCapabilityReference(reference);
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new TypeError("input must be a JSON object.");
    if (
      !options.idempotencyKey.trim() ||
      options.idempotencyKey.length > 255 ||
      /[\r\n]/.test(options.idempotencyKey)
    )
      throw new TypeError(
        "idempotencyKey must contain 1-255 characters without newlines.",
      );
    const { idempotencyKey, retry, ...view } = options;
    return this.capabilityRequest(
      {
        reference,
        operation: "start",
        input,
        idempotency_key: idempotencyKey,
        ...view,
      },
      {
        headers: { "idempotency-key": idempotencyKey },
        ...(reference === "data:web.research" ? {} : { retry }),
        timeoutMs: 95_000,
      },
    );
  }

  getCapabilityStatus(
    reference: string,
    taskId: string,
    view: CapabilityView = {},
  ): Promise<CapabilityResult> {
    assertCapabilityReference(reference);
    if (!taskId.trim()) throw new TypeError("task_id is required.");
    return this.capabilityRequest(
      { reference, operation: "status", task_id: taskId, ...view },
      { retry: { maxAttempts: 3 } },
    );
  }

  getCapabilityResult(
    reference: string,
    requestId: string,
    view: CapabilityView = {},
  ): Promise<CapabilityResult> {
    assertCapabilityReference(reference);
    if (!requestId.trim()) throw new TypeError("request_id is required.");
    return this.capabilityRequest(
      { reference, operation: "result", request_id: requestId, ...view },
      { retry: { maxAttempts: 3 } },
    );
  }

  private async capabilityRequest(
    body: Record<string, unknown>,
    options: RequestOptions = {},
  ): Promise<CapabilityResult> {
    const reply = await this.request<Record<string, unknown>>(
      "/v1/capabilities/run",
      { method: "POST", body, responseShape: "raw", ...options },
    );
    // Sync data is a raw result. Async tasks are wrapped in data with next alongside it.
    if (
      !reply.object &&
      reply.data &&
      typeof reply.data === "object" &&
      !Array.isArray(reply.data)
    ) {
      return {
        ...reply.data,
        ...(reply.next ? { next: reply.next } : {}),
      } as CapabilityResult;
    }
    return reply as CapabilityResult;
  }

  searchWeb(
    input: Pick<components["schemas"]["WebSearchRequest"], "query"> &
      Partial<components["schemas"]["WebSearchRequest"]>,
  ): Promise<components["schemas"]["WebSearchResponse"]> {
    return this.request("/v1/web/search", {
      method: "POST",
      body: input,
      responseShape: "raw",
      timeoutMs: 35_000,
    });
  }
  readWebPages(
    input: Pick<components["schemas"]["WebReadRequest"], "urls"> &
      Partial<components["schemas"]["WebReadRequest"]>,
  ): Promise<components["schemas"]["WebReadResponse"]> {
    return this.request("/v1/web/read", {
      method: "POST",
      body: input,
      responseShape: "raw",
      timeoutMs: 75_000,
    });
  }
  mapWebsite(
    input: Pick<components["schemas"]["WebMapRequest"], "url"> &
      Partial<components["schemas"]["WebMapRequest"]>,
  ): Promise<components["schemas"]["WebMapResponse"]> {
    return this.request("/v1/web/map", {
      method: "POST",
      body: input,
      responseShape: "raw",
      timeoutMs: 60_000,
    });
  }
  researchWeb(
    input: Pick<components["schemas"]["WebResearchRequest"], "query"> &
      Partial<components["schemas"]["WebResearchRequest"]>,
  ): Promise<components["schemas"]["WebResearchResponse"] | CapabilityResult> {
    return this.request("/v1/web/research", {
      method: "POST",
      body: input,
      responseShape: "raw",
      timeoutMs: 95_000,
    });
  }

  listWorkflows(): Promise<BeatAPIWorkflow[]> {
    return this.request<{ object: "list"; data: BeatAPIWorkflow[] }>(
      "/v1/workflows",
      { authenticated: false },
    ).then((result) => result.data);
  }

  async listPublicTextModels(): Promise<
    components["schemas"]["PublicTextModel"][]
  > {
    const list = await this.request<{
      data: components["schemas"]["PublicTextModel"][];
    }>("/v1/text/models", { authenticated: false });
    return list.data;
  }

  listTextModels(): Promise<BeatAPITextModel[]> {
    return this.request<{ object: "list"; data: BeatAPITextModel[] }>(
      "/v1/models",
      { responseShape: "raw" },
    ).then((result) => result.data);
  }

  listGenerationModels(): Promise<BeatAPIGenerationModel[]> {
    return this.request<{ object: "list"; data: BeatAPIGenerationModel[] }>(
      "/v1/media/models",
      { authenticated: false },
    ).then((result) => result.data);
  }

  createImageTask(
    input: ImageGenerationTaskInput,
    options: { idempotencyKey?: string } = {},
  ): Promise<BeatAPITask> {
    return this.request("/v1/images/tasks", {
      method: "POST",
      body: input,
      ...(options.idempotencyKey
        ? { headers: { "idempotency-key": options.idempotencyKey } }
        : {}),
    });
  }

  createVideoTask(
    input: VideoGenerationTaskInput,
    options: { idempotencyKey?: string } = {},
  ): Promise<BeatAPITask> {
    return this.request("/v1/videos/tasks", {
      method: "POST",
      body: input,
      ...(options.idempotencyKey
        ? { headers: { "idempotency-key": options.idempotencyKey } }
        : {}),
    });
  }

  listEffects(
    filters: { outputType?: "image" | "video"; category?: string } = {},
  ): Promise<BeatAPIEffect[]> {
    const query = new URLSearchParams();
    if (filters.outputType) query.set("output_type", filters.outputType);
    if (filters.category) query.set("category", filters.category);
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return this.request<{ object: "list"; data: BeatAPIEffect[] }>(
      `/v1/effects${suffix}`,
      { authenticated: false },
    ).then((result) => result.data);
  }

  getEffect(effectId: string): Promise<BeatAPIEffect> {
    return this.request(`/v1/effects/${encodePathSegment(effectId)}`, {
      authenticated: false,
    });
  }

  createEffectTask(
    input: CreateEffectTaskInput,
    options: { idempotencyKey: string },
  ): Promise<BeatAPITask> {
    const idempotencyKey = options.idempotencyKey.trim();
    if (!idempotencyKey) {
      throw new TypeError("idempotencyKey must not be empty.");
    }
    return this.request("/v1/effects/tasks", {
      method: "POST",
      body: input,
      headers: { "idempotency-key": idempotencyKey },
    });
  }

  createTextResponse(input: TextResponseInput): Promise<TextResponseOutput> {
    return this.request("/v1/responses", {
      method: "POST",
      body: input,
      responseShape: "raw",
    });
  }

  createVideoAnalysisTask(
    input: VideoAnalysisTaskInput,
    options: { idempotencyKey?: string } = {},
  ): Promise<BeatAPITask> {
    const idempotencyKey = options.idempotencyKey?.trim();
    return this.request("/v1/video-analysis/tasks", {
      method: "POST",
      body: input,
      ...(idempotencyKey
        ? { headers: { "idempotency-key": idempotencyKey } }
        : {}),
    });
  }

  getUsage(period?: "all" | "24h" | "7d" | "30d"): Promise<BeatAPIUsage> {
    if (period && !["all", "24h", "7d", "30d"].includes(period))
      throw new TypeError("Invalid usage period.");
    return this.request(period ? "/v1/usage?period=" + period : "/v1/usage");
  }

  createRealtimeSession(
    input: CreateRealtimeSessionInput,
    options: { idempotencyKey: string },
  ): Promise<BeatAPIRealtimeSession> {
    const idempotencyKey = options.idempotencyKey.trim();
    if (!idempotencyKey) {
      throw new TypeError("idempotencyKey must not be empty.");
    }
    return this.request("/v1/realtime/sessions", {
      method: "POST",
      body: input,
      headers: { "idempotency-key": idempotencyKey },
    });
  }

  getRealtimeSession(sessionId: string): Promise<BeatAPIRealtimeSession> {
    return this.request(
      `/v1/realtime/sessions/${encodePathSegment(sessionId)}`,
    );
  }

  closeRealtimeSession(sessionId: string): Promise<BeatAPIRealtimeSession> {
    return this.request(
      `/v1/realtime/sessions/${encodePathSegment(sessionId)}`,
      { method: "DELETE" },
    );
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
      const task = await this.getTask(taskId, {
        retry: { maxAttempts: 3 },
      });
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
