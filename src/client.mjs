import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

const TERMINAL_STATUSES = new Set(["succeeded", "failed"]);

const MIME_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".aac", "audio/aac"],
  [".m4a", "audio/mp4"],
  [".srt", "application/x-subrip"],
]);

export class BeatAPIError extends Error {
  constructor(message, { status, code, requestId, details } = {}) {
    super(message);
    this.name = "BeatAPIError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

export class BeatAPIClient {
  constructor({
    apiKey = process.env.BEATAPI_API_KEY,
    baseUrl = process.env.BEATAPI_BASE_URL || "https://api.beatapi.io",
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new Error("Node.js 20 or newer is required.");
    }

    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetch = fetchImpl;
  }

  async request(path, { method = "GET", body, authenticated = true } = {}) {
    if (authenticated && !this.apiKey) {
      throw new Error(
        "BEATAPI_API_KEY is required. Create a key in the BeatAPI dashboard.",
      );
    }

    const headers = { accept: "application/json" };
    if (authenticated) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }

    let requestBody = body;
    if (body !== undefined && !(body instanceof FormData)) {
      headers["content-type"] = "application/json";
      requestBody = JSON.stringify(body);
    }

    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: requestBody,
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = payload.error || {};
      throw new BeatAPIError(
        error.message || `Request failed with HTTP ${response.status}.`,
        {
          status: response.status,
          code: error.code,
          requestId: error.request_id,
          details: error.details,
        },
      );
    }

    return payload.data;
  }

  listWorkflows() {
    return this.request("/v1/workflows", { authenticated: false });
  }

  getUsage() {
    return this.request("/v1/usage");
  }

  getTask(taskId) {
    return this.request(`/v1/tasks/${encodeURIComponent(taskId)}`);
  }

  createMusicVideoTask(input) {
    return this.request("/v1/music-video/tasks", {
      method: "POST",
      body: input,
    });
  }

  createEcommerceVideoTask(input) {
    return this.request("/v1/ecommerce-video/tasks", {
      method: "POST",
      body: input,
    });
  }

  async uploadFile(filePath) {
    const extension = extname(filePath).toLowerCase();
    const mimeType = MIME_TYPES.get(extension);
    if (!mimeType) {
      throw new Error(`Unsupported file extension: ${extension || "(none)"}`);
    }

    const content = await readFile(filePath);
    const form = new FormData();
    form.append(
      "file",
      new Blob([content], { type: mimeType }),
      basename(filePath),
    );
    form.append("purpose", "input");

    return this.request("/v1/files", {
      method: "POST",
      body: form,
    });
  }

  async waitForTask(
    taskId,
    { intervalMs = 5_000, maxAttempts = 120, onUpdate } = {},
  ) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const task = await this.getTask(taskId);
      onUpdate?.(task, attempt);

      if (TERMINAL_STATUSES.has(task.status)) {
        return task;
      }

      if (
        task.status === "storyboard_ready" ||
        task.status === "requires_action"
      ) {
        return task;
      }

      if (attempt < maxAttempts) {
        const jitter = Math.floor(intervalMs * 0.2 * Math.random());
        await new Promise((resolve) =>
          setTimeout(resolve, intervalMs + jitter),
        );
      }
    }

    throw new Error(
      `Task ${taskId} did not reach a terminal or actionable state after ${maxAttempts} attempts.`,
    );
  }
}

