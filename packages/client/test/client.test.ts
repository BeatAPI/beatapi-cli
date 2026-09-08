import assert from "node:assert/strict";
import test from "node:test";

import {
  BeatAPIClient,
  BeatAPIError,
  type BeatAPITask,
} from "../src/index.js";

function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

test("rejects unsafe API origins unless an operator explicitly trusts HTTPS", () => {
  assert.throws(
    () => new BeatAPIClient({ apiKey: "test", baseUrl: "http://example.com" }),
    /HTTPS origin/i,
  );
  assert.throws(
    () => new BeatAPIClient({ apiKey: "test", baseUrl: "https://example.com" }),
    /explicit.*operator setting/i,
  );
  assert.equal(
    new BeatAPIClient({
      apiKey: "test",
      baseUrl: "https://example.com",
      trustCustomBaseUrl: true,
    }).baseUrl,
    "https://example.com",
  );
  assert.equal(
    new BeatAPIClient({
      apiKey: "test",
      baseUrl: "http://127.0.0.1:3000",
      allowInsecureLocalhost: true,
    }).baseUrl,
    "http://127.0.0.1:3000",
  );
});

test("parses success envelopes and sends bearer authentication", async () => {
  let authorization = "";
  const client = new BeatAPIClient({
    apiKey: "sk_test_value",
    fetch: async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") || "";
      return jsonResponse({
        data: {
          object: "usage",
          credit_balance: 50,
          total_tasks: 0,
          credits_settled: 0,
          credits_refunded: 0,
          concurrency: { limit: 1, active: 0 },
          by_workflow: [],
        },
      });
    },
  });

  const usage = await client.getUsage();

  assert.equal(usage.credit_balance, 50);
  assert.equal(authorization, "Bearer sk_test_value");
});

test("lists the authenticated text-model catalog in its OpenAI-compatible shape", async () => {
  let authorization = "";
  const client = new BeatAPIClient({
    apiKey: "sk_test_value",
    fetch: async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") || "";
      return jsonResponse({
        object: "list",
        data: [
          { id: "gpt-5.6-terra", object: "model", created: 1, owned_by: "beatapi" },
        ],
      });
    },
  });

  const models = await client.listTextModels();

  assert.equal(models[0]?.id, "gpt-5.6-terra");
  assert.equal(authorization, "Bearer sk_test_value");
});

test("creates a non-streaming text response without unwrapping the provider payload", async () => {
  let request: { path: string; body: unknown } | undefined;
  const client = new BeatAPIClient({
    apiKey: "sk_test_value",
    fetch: async (input, init) => {
      request = {
        path: new URL(String(input)).pathname,
        body: JSON.parse(String(init?.body)) as unknown,
      };
      return jsonResponse({
        id: "resp_test",
        object: "response",
        output_text: "A concise answer.",
      });
    },
  });

  const response = await client.createTextResponse({
    model: "gpt-5.6-terra",
    input: "Summarize this.",
    stream: false,
  });

  assert.deepEqual(request, {
    path: "/v1/responses",
    body: {
      model: "gpt-5.6-terra",
      input: "Summarize this.",
      stream: false,
    },
  });
  assert.equal((response as { output_text: string }).output_text, "A concise answer.");
});

test("creates a video-analysis task with an idempotency key", async () => {
  let request: { path: string; idempotencyKey: string | null; body: unknown } | undefined;
  const client = new BeatAPIClient({
    apiKey: "sk_test_value",
    fetch: async (input, init) => {
      request = {
        path: new URL(String(input)).pathname,
        idempotencyKey: new Headers(init?.headers).get("idempotency-key"),
        body: JSON.parse(String(init?.body)) as unknown,
      };
      return jsonResponse({ data: { id: "task_analysis", status: "queued" } });
    },
  });

  const task = await client.createVideoAnalysisTask(
    {
      video_url: "https://media.example.com/input.mp4",
      prompt: "Return timestamped scene changes.",
      analysis_depth: "deep",
    },
    { idempotencyKey: "analysis-test" },
  );

  assert.equal(task.id, "task_analysis");
  assert.deepEqual(request, {
    path: "/v1/video-analysis/tasks",
    idempotencyKey: "analysis-test",
    body: {
      video_url: "https://media.example.com/input.mp4",
      prompt: "Return timestamped scene changes.",
      analysis_depth: "deep",
    },
  });
});

test("discovers generation models and creates image and video tasks", async () => {
  const requests: Array<{ method: string; path: string; authorization: string | null }> = [];
  const client = new BeatAPIClient({
    apiKey: "sk_test_value",
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      requests.push({
        method: init?.method || "GET",
        path,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      if (path === "/v1/media/models") {
        return jsonResponse({
          data: {
            object: "list",
            data: [
              {
                id: "nano-banana-2",
                object: "generation_model",
                name: "Nano Banana 2",
                media_type: "image",
                input_modes: ["text", "image"],
              },
            ],
          },
        });
      }
      return jsonResponse({ data: { id: "task_media", status: "queued" } });
    },
  });

  const models = await client.listGenerationModels();
  await client.createImageTask({ model: "nano-banana-2", prompt: "Still" });
  await client.createVideoTask({ model: "seedance-2.5", prompt: "Motion" });

  assert.equal(models[0]?.id, "nano-banana-2");
  assert.deepEqual(requests, [
    { method: "GET", path: "/v1/media/models", authorization: null },
    { method: "POST", path: "/v1/images/tasks", authorization: "Bearer sk_test_value" },
    { method: "POST", path: "/v1/videos/tasks", authorization: "Bearer sk_test_value" },
  ]);
});

test("discovers Effect contracts and creates a versioned Effect task", async () => {
  const requests: Array<{ method: string; path: string; query: string; idempotencyKey: string | null }> = [];
  const client = new BeatAPIClient({
    apiKey: "sk_test_value",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      requests.push({
        method: init?.method || "GET",
        path: url.pathname,
        query: url.search,
        idempotencyKey: new Headers(init?.headers).get("idempotency-key"),
      });
      if (url.pathname === "/v1/effects") {
        return jsonResponse({ data: { object: "list", data: [{ id: "muscle", version: 1 }] } });
      }
      if (url.pathname === "/v1/effects/muscle") {
        return jsonResponse({ data: { id: "muscle", version: 1 } });
      }
      return jsonResponse({ data: { id: "task_effect", status: "queued" } });
    },
  });

  const effects = await client.listEffects({ outputType: "video", category: "transformation" });
  const effect = await client.getEffect("muscle");
  const task = await client.createEffectTask(
    {
      effect_id: "muscle",
      effect_version: 1,
      images: ["https://media.example.com/portrait.png"],
    },
    { idempotencyKey: "effect-test" },
  );

  assert.equal(effects[0]?.id, "muscle");
  assert.equal(effect.version, 1);
  assert.equal(task.id, "task_effect");
  assert.deepEqual(requests, [
    {
      method: "GET",
      path: "/v1/effects",
      query: "?output_type=video&category=transformation",
      idempotencyKey: null,
    },
    { method: "GET", path: "/v1/effects/muscle", query: "", idempotencyKey: null },
    {
      method: "POST",
      path: "/v1/effects/tasks",
      query: "",
      idempotencyKey: "effect-test",
    },
  ]);
});

test("preserves structured errors, request id, and retry-after", async () => {
  const client = new BeatAPIClient({
    apiKey: "sk_test_value",
    fetch: async () =>
      jsonResponse(
        {
          error: {
            code: "rate_limit_exceeded",
            message: "Slow down.",
            request_id: "req_test",
            retry_after_seconds: 12,
          },
        },
        { status: 429, headers: { "retry-after": "12" } },
      ),
  });

  await assert.rejects(
    client.getUsage(),
    (error: unknown) => {
      assert.ok(error instanceof BeatAPIError);
      assert.equal(error.status, 429);
      assert.equal(error.code, "rate_limit_exceeded");
      assert.equal(error.requestId, "req_test");
      assert.equal(error.retryAfterSeconds, 12);
      return true;
    },
  );
});

test("retries retryable server failures with bounded backoff", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const client = new BeatAPIClient({
    apiKey: "sk_test_value",
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
    random: () => 0,
    fetch: async () => {
      attempts += 1;
      if (attempts < 3) {
        return jsonResponse(
          {
            error: {
              code: "internal_error",
              message: "Temporary failure.",
              request_id: `req_${attempts}`,
            },
          },
          { status: 503 },
        );
      }
      return jsonResponse({ data: { id: "task_ok", status: "queued" } });
    },
  });

  const task = await client.getTask("task_ok", {
    retry: { maxAttempts: 3, baseDelayMs: 100 },
  });

  assert.equal(task.id, "task_ok");
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [100, 200]);
});

test("honors the full server Retry-After delay", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const client = new BeatAPIClient({
    apiKey: "sk_test_value",
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
    fetch: async () => {
      attempts += 1;
      if (attempts === 1) {
        return jsonResponse(
          {
            error: {
              code: "rate_limit_exceeded",
              message: "Wait before retrying.",
              retry_after_seconds: 60,
            },
          },
          { status: 429 },
        );
      }
      return jsonResponse({ data: { id: "task_ok", status: "queued" } });
    },
  });

  await client.getTask("task_ok", {
    retry: { maxAttempts: 2, maxDelayMs: 10_000 },
  });

  assert.deepEqual(delays, [60_000]);
});

test("waitForTask stops on actionable manual storyboard states", async () => {
  const updates: string[] = [];
  const states: BeatAPITask[] = [
    { id: "task_1", status: "queued" } as BeatAPITask,
    { id: "task_1", status: "storyboard_ready" } as BeatAPITask,
  ];
  const client = new BeatAPIClient({
    apiKey: "sk_test_value",
    sleep: async () => undefined,
    fetch: async () => jsonResponse({ data: states.shift() }),
  });

  const task = await client.waitForTask("task_1", {
    intervalMs: 1,
    maxAttempts: 3,
    onUpdate: (update) => updates.push(update.status),
  });

  assert.equal(task.status, "storyboard_ready");
  assert.deepEqual(updates, ["queued", "storyboard_ready"]);
});

test("waitForTask survives a transient network failure", async () => {
  let requests = 0;
  const client = new BeatAPIClient({
    apiKey: "sk_test_value",
    sleep: async () => undefined,
    random: () => 0,
    fetch: async () => {
      requests += 1;
      if (requests === 1) throw new Error("temporary network failure");
      return jsonResponse({
        data: {
          id: "task_1",
          status: requests === 2 ? "processing" : "succeeded",
        },
      });
    },
  });

  const task = await client.waitForTask("task_1", {
    intervalMs: 1,
    maxAttempts: 2,
  });

  assert.equal(task.status, "succeeded");
  assert.equal(requests, 3);
});

test("exposes the complete launch workflow methods", async () => {
  const requests: Array<{ method: string; path: string }> = [];
  const client = new BeatAPIClient({
    apiKey: "sk_test_value",
    fetch: async (input, init) => {
      requests.push({
        method: init?.method || "GET",
        path: new URL(String(input)).pathname,
      });
      return jsonResponse({ data: { id: "ok", deleted: true } });
    },
  });

  await client.createMusicVideoTask({ images: [], audio_url: "" });
  await client.editMusicVideoShot("task", "shot", { prompt: "new" });
  await client.getMusicVideoShotMedia("task", "shot");
  await client.composeMusicVideoTask("task", { shot_ids: ["shot"] });
  await client.createEcommerceVideoTask({ images: [], duration: 15 });
  await client.listWebhooks();
  await client.createWebhook({ url: "https://example.com/hook" });
  await client.getWebhook("wh");
  await client.updateWebhook("wh", { status: "disabled" });
  await client.deleteWebhook("wh");

  assert.deepEqual(requests, [
    { method: "POST", path: "/v1/music-video/tasks" },
    {
      method: "POST",
      path: "/v1/music-video/tasks/task/shots/shot/edit",
    },
    {
      method: "POST",
      path: "/v1/music-video/tasks/task/shots/shot/media",
    },
    { method: "POST", path: "/v1/music-video/tasks/task/compose" },
    { method: "POST", path: "/v1/ecommerce-video/tasks" },
    { method: "GET", path: "/v1/webhooks" },
    { method: "POST", path: "/v1/webhooks" },
    { method: "GET", path: "/v1/webhooks/wh" },
    { method: "PATCH", path: "/v1/webhooks/wh" },
    { method: "DELETE", path: "/v1/webhooks/wh" },
  ]);
});

test("creates, reads, and closes realtime sessions with safe request semantics", async () => {
  const requests: Array<{
    method: string;
    path: string;
    idempotencyKey: string | null;
    body?: unknown;
  }> = [];
  const client = new BeatAPIClient({
    apiKey: "sk_test_value",
    fetch: async (input, init) => {
      requests.push({
        method: init?.method || "GET",
        path: new URL(String(input)).pathname,
        idempotencyKey:
          new Headers(init?.headers).get("idempotency-key"),
        ...(init?.body
          ? { body: JSON.parse(String(init.body)) as unknown }
          : {}),
      });
      return jsonResponse({
        data: {
          id: "brt_test",
          object: "realtime.session",
          status: "ready",
          expires_at: "2026-07-31T12:00:00Z",
          max_duration_seconds: 60,
          allowed_origins: ["https://app.example.com"],
          credits: { reserved: 1, settled: 0, refunded: 0 },
          request_id: "req_test",
          created_at: "2026-07-31T11:59:00Z",
          connected_at: null,
          closed_at: null,
        },
      });
    },
  });

  await client.createRealtimeSession(
    {
      max_duration_seconds: 60,
      allowed_origins: ["https://app.example.com"],
    },
    { idempotencyKey: "rt-test-key" },
  );
  await client.getRealtimeSession("session/encoded");
  await client.closeRealtimeSession("session/encoded");

  assert.deepEqual(requests, [
    {
      method: "POST",
      path: "/v1/realtime/sessions",
      idempotencyKey: "rt-test-key",
      body: {
        max_duration_seconds: 60,
        allowed_origins: ["https://app.example.com"],
      },
    },
    {
      method: "GET",
      path: "/v1/realtime/sessions/session%2Fencoded",
      idempotencyKey: null,
    },
    {
      method: "DELETE",
      path: "/v1/realtime/sessions/session%2Fencoded",
      idempotencyKey: null,
    },
  ]);
});

test("rejects a missing realtime idempotency key before making a request", async () => {
  let requests = 0;
  const client = new BeatAPIClient({
    apiKey: "sk_test_value",
    fetch: async () => {
      requests += 1;
      return jsonResponse({ data: {} });
    },
  });

  assert.throws(
    () => client.createRealtimeSession(
      {
        max_duration_seconds: 60,
        allowed_origins: ["https://app.example.com"],
      },
      { idempotencyKey: "" },
    ),
    /idempotencyKey must not be empty/,
  );
  assert.equal(requests, 0);
});
