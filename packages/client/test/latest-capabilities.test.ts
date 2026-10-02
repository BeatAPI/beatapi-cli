import assert from "node:assert/strict";
import test from "node:test";
import { BeatAPIClient } from "../src/client.js";

test("preview and stored result reads preserve next instructions without re-running the capability", async () => {
  const requests: unknown[] = [];
  const client = new BeatAPIClient({
    apiKey: "fixture",
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      return Response.json({
        object: "web.search",
        request_id: "request_fixture",
        items: [{ title: "Evidence" }],
        next: { action: "result" },
        usage: { price_usd: "0.005" },
      });
    },
  });
  const started = await client.runCapability(
    "data:web.search",
    { query: "test" },
    { idempotencyKey: "once", view: "preview", max_items: 2 },
  );
  assert.equal(started.next?.action, "result");
  const result = await client.getCapabilityResult(
    "data:web.search",
    "request_fixture",
    { fields: ["items[].title"] },
  );
  assert.deepEqual(result.items, [{ title: "Evidence" }]);
  assert.deepEqual(requests, [
    {
      reference: "data:web.search",
      operation: "start",
      input: { query: "test" },
      idempotency_key: "once",
      view: "preview",
      max_items: 2,
    },
    {
      reference: "data:web.search",
      operation: "result",
      request_id: "request_fixture",
      fields: ["items[].title"],
    },
  ]);
});

test("Web calls preserve raw replies and research 202 is returned for polling", async () => {
  const calls: string[] = [];
  const client = new BeatAPIClient({
    apiKey: "fixture",
    fetch: async (url, init) => {
      calls.push(String(url));
      assert.equal(init?.redirect, "error");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer fixture",
      );
      const path = String(url).split("/").at(-1);
      return Response.json(
        path === "research"
          ? { request_id: "task_fixture", next: { action: "status" } }
          : { object: `web.${path}`, results: [], usage: { price_usd: "0" } },
        { status: path === "research" ? 202 : 200 },
      );
    },
  });
  assert.equal(
    (await client.searchWeb({ query: "test" })).object,
    "web.search",
  );
  await client.readWebPages({ urls: ["https://example.com"] });
  await client.mapWebsite({ url: "https://example.com" });
  assert.equal(
    (await client.researchWeb({ query: "test" })).request_id,
    "task_fixture",
  );
  assert.equal(calls.length, 4);
});

test("public text metadata discovery needs no credentials and preserves configured limits", async () => {
  const client = new BeatAPIClient({
    fetch: async (url, init) => {
      assert.ok(String(url).endsWith("/v1/text/models"));
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      return Response.json({
        data: {
          object: "list",
          data: [
            {
              id: "gpt-6.1-sol",
              family: "codex",
              endpoints: ["openai-response"],
              context_length: 1050000,
              max_output_tokens: 128000,
            },
          ],
        },
      });
    },
  });
  assert.equal(
    (await client.listPublicTextModels())[0]?.max_output_tokens,
    128000,
  );
});

test("explicit non-retryable gateway errors do not repeat a paid start", async () => {
  let calls = 0;
  const client = new BeatAPIClient({
    apiKey: "fixture",
    sleep: async () => {},
    fetch: async () => {
      calls++;
      return Response.json(
        {
          error: {
            code: "processing_failed",
            message: "Failed",
            retryable: false,
          },
        },
        { status: 503 },
      );
    },
  });
  await assert.rejects(
    client.runCapability(
      "model:fixture",
      {},
      { idempotencyKey: "same", retry: { maxAttempts: 3 } },
    ),
  );
  assert.equal(calls, 1);
});
