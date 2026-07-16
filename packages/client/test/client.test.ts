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
