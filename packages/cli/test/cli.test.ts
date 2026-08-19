import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { run } from "../src/cli.js";

function outputCollector() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: (text: string) => {
        stdout += text;
      },
      stderr: (text: string) => {
        stderr += text;
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

test("auth login validates usage before storing the key", async () => {
  const output = outputCollector();
  let saved = "";
  const exitCode = await run(["auth", "login"], {
    ...output.io,
    promptSecret: async () => "sk_valid_key",
    credentialStore: {
      get: async () => null,
      set: async (value: string) => {
        saved = value;
      },
      delete: async () => undefined,
    },
    createClient: () => ({
      getUsage: async () => ({
        credit_balance: 50,
        concurrency: { limit: 1, active: 0 },
      }),
    }),
  });

  assert.equal(exitCode, 0);
  assert.equal(saved, "sk_valid_key");
  assert.match(output.stdout(), /Connected/);
  assert.doesNotMatch(output.stdout(), /sk_valid_key/);
});

test("auth status reports environment authentication without revealing the key", async () => {
  const output = outputCollector();
  const exitCode = await run(["auth", "status"], {
    ...output.io,
    env: { BEATAPI_API_KEY: "sk_environment_secret" },
    credentialStore: {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined,
    },
    createClient: () => ({
      getUsage: async () => ({
        credit_balance: 40,
        concurrency: { limit: 1, active: 0 },
      }),
    }),
  });

  assert.equal(exitCode, 0);
  assert.match(output.stdout(), /environment/);
  assert.doesNotMatch(output.stdout(), /sk_environment_secret/);
});

test("anonymous workflow discovery never reads credentials", async () => {
  const output = outputCollector();
  let credentialReads = 0;
  const exitCode = await run(["workflows", "list"], {
    ...output.io,
    credentialStore: {
      get: async () => {
        credentialReads += 1;
        throw new Error("credential storage should not be touched");
      },
      set: async () => undefined,
      delete: async () => undefined,
    },
    createClient: () => ({
      listWorkflows: async () => [{ id: "music-video" }],
    }),
  });

  assert.equal(exitCode, 0);
  assert.equal(credentialReads, 0);
  assert.match(output.stdout(), /music-video/);
});

test("supports anonymous model and Effect discovery plus generation commands", async () => {
  const output = outputCollector();
  const directory = await mkdtemp(resolve(tmpdir(), "beatapi-cli-generation-"));
  const inputPath = resolve(directory, "input.json");
  await writeFile(inputPath, JSON.stringify({ model: "nano-banana", prompt: "Still" }));
  const calls: unknown[] = [];
  let credentialReads = 0;
  const discoveryClient = {
    listGenerationModels: async () => {
      calls.push(["models"]);
      return [{ id: "nano-banana" }];
    },
    listEffects: async (filters: unknown) => {
      calls.push(["effects-list", filters]);
      return [{ id: "video-muscle-max" }];
    },
    getEffect: async (id: string) => {
      calls.push(["effects-get", id]);
      return { id };
    },
  };

  try {
    const credentialStore = {
      get: async () => {
        credentialReads += 1;
        throw new Error("anonymous discovery must not read credentials");
      },
      set: async () => undefined,
      delete: async () => undefined,
    };
    assert.equal(
      await run(["models", "list"], {
        ...output.io,
        credentialStore,
        createClient: () => discoveryClient,
      }),
      0,
    );
    assert.equal(
      await run(["effects", "list", "--output-type", "video"], {
        ...output.io,
        credentialStore,
        createClient: () => discoveryClient,
      }),
      0,
    );
    assert.equal(
      await run(["effects", "get", "video/muscle"], {
        ...output.io,
        credentialStore,
        createClient: () => discoveryClient,
      }),
      0,
    );
    assert.equal(credentialReads, 0);

    const mutationClient = {
      createImageTask: async (input: unknown) => {
        calls.push(["image", input]);
        return { id: "task_image" };
      },
      createVideoTask: async (input: unknown) => {
        calls.push(["video", input]);
        return { id: "task_video" };
      },
      createEffectTask: async (input: unknown, options: unknown) => {
        calls.push(["effect-create", input, options]);
        return { id: "task_effect" };
      },
    };
    await run(["images", "create", "--file", inputPath], {
      ...output.io,
      apiKey: "sk_test",
      createClient: () => mutationClient,
    });
    await run(["videos", "create", "--file", inputPath], {
      ...output.io,
      apiKey: "sk_test",
      createClient: () => mutationClient,
    });
    await run([
      "effects",
      "create",
      "--file",
      inputPath,
      "--idempotency-key",
      "effect-cli-123",
    ], {
      ...output.io,
      apiKey: "sk_test",
      createClient: () => mutationClient,
    });

    assert.deepEqual(calls, [
      ["models"],
      ["effects-list", { outputType: "video" }],
      ["effects-get", "video/muscle"],
      ["image", { model: "nano-banana", prompt: "Still" }],
      ["video", { model: "nano-banana", prompt: "Still" }],
      [
        "effect-create",
        { model: "nano-banana", prompt: "Still" },
        { idempotencyKey: "effect-cli-123" },
      ],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("task wait sends progress to stderr and result JSON to stdout", async () => {
  const output = outputCollector();
  const exitCode = await run(
    ["tasks", "wait", "task_1", "--interval", "5000", "--attempts", "2"],
    {
      ...output.io,
      apiKey: "sk_test",
      createClient: () => ({
        waitForTask: async (
          _taskId: string,
          options: { onUpdate?: (task: { id: string; status: string }, attempt: number) => void },
        ) => {
          options.onUpdate?.({ id: "task_1", status: "processing" }, 1);
          return { id: "task_1", status: "succeeded" };
        },
      }),
    },
  );

  assert.equal(exitCode, 0);
  assert.match(output.stderr(), /processing/);
  assert.match(output.stdout(), /"succeeded"/);
});

test("supports music-video manual workflow and webhook commands", async () => {
  const calls: string[] = [];
  const output = outputCollector();
  const client = {
    editMusicVideoShot: async () => {
      calls.push("edit");
      return { id: "task" };
    },
    getMusicVideoShotMedia: async () => {
      calls.push("media");
      return { task_id: "task" };
    },
    composeMusicVideoTask: async () => {
      calls.push("compose");
      return { id: "task" };
    },
    listWebhooks: async () => {
      calls.push("webhooks-list");
      return { data: [] };
    },
  };

  assert.equal(
    await run(
      ["music-video", "shots", "edit", "task", "shot", "--prompt", "new"],
      { ...output.io, apiKey: "sk_test", createClient: () => client },
    ),
    0,
  );
  assert.equal(
    await run(["music-video", "shots", "media", "task", "shot"], {
      ...output.io,
      apiKey: "sk_test",
      createClient: () => client,
    }),
    0,
  );
  assert.equal(
    await run(
      ["music-video", "compose", "task", "--shot", "shot", "--shot", "shot2"],
      { ...output.io, apiKey: "sk_test", createClient: () => client },
    ),
    0,
  );
  assert.equal(
    await run(["webhooks", "list"], {
      ...output.io,
      apiKey: "sk_test",
      createClient: () => client,
    }),
    0,
  );

  assert.deepEqual(calls, ["edit", "media", "compose", "webhooks-list"]);
});

test("supports realtime session create, get, and close commands", async () => {
  const output = outputCollector();
  const calls: unknown[] = [];
  const client = {
    createRealtimeSession: async (input: unknown, options: unknown) => {
      calls.push(["create", input, options]);
      return { id: "brt_test", status: "ready" };
    },
    getRealtimeSession: async (id: string) => {
      calls.push(["get", id]);
      return { id, status: "active" };
    },
    closeRealtimeSession: async (id: string) => {
      calls.push(["close", id]);
      return { id, status: "closed" };
    },
  };

  assert.equal(
    await run(
      [
        "realtime",
        "sessions",
        "create",
        "--duration",
        "60",
        "--origin",
        "https://app.example.com",
        "--origin",
        "https://preview.example.com",
        "--metadata",
        "customer_id=cus_123",
        "--idempotency-key",
        "rt_cli_test",
      ],
      { ...output.io, apiKey: "sk_test", createClient: () => client },
    ),
    0,
  );
  assert.equal(
    await run(["realtime", "sessions", "get", "brt_test"], {
      ...output.io,
      apiKey: "sk_test",
      createClient: () => client,
    }),
    0,
  );
  assert.equal(
    await run(["realtime", "sessions", "close", "brt_test"], {
      ...output.io,
      apiKey: "sk_test",
      createClient: () => client,
    }),
    0,
  );

  assert.deepEqual(calls, [
    [
      "create",
      {
        max_duration_seconds: 60,
        allowed_origins: [
          "https://app.example.com",
          "https://preview.example.com",
        ],
        metadata: { customer_id: "cus_123" },
      },
      { idempotencyKey: "rt_cli_test" },
    ],
    ["get", "brt_test"],
    ["close", "brt_test"],
  ]);
});

test("validates realtime session duration and origins", async () => {
  const output = outputCollector();
  await assert.rejects(
    run(
      [
        "realtime",
        "sessions",
        "create",
        "--duration",
        "45",
        "--origin",
        "https://app.example.com",
      ],
      {
        ...output.io,
        apiKey: "sk_test",
        createClient: () => ({ createRealtimeSession: async () => ({}) }),
      },
    ),
    /15, 60, or 300/,
  );
});

test("webhook creation stores the one-time secret instead of printing it", async () => {
  const output = outputCollector();
  const directory = await mkdtemp(resolve(tmpdir(), "beatapi-cli-webhook-"));
  const inputPath = resolve(directory, "webhook.json");
  await writeFile(
    inputPath,
    JSON.stringify({ url: "https://example.com/webhooks/beatapi" }),
  );

  try {
    const exitCode = await run(
      ["webhooks", "create", "--file", inputPath],
      {
        ...output.io,
        apiKey: "sk_test",
        env: { BEATAPI_CONFIG_DIR: directory },
        createClient: () => ({
          createWebhook: async () => ({
            id: "wh_test",
            url: "https://example.com/webhooks/beatapi",
            secret: "whsec_one_time_secret",
          }),
          deleteWebhook: async () => ({ deleted: true }),
        }),
      },
    );

    assert.equal(exitCode, 0);
    assert.doesNotMatch(output.stdout(), /whsec_one_time_secret/);
    const result = JSON.parse(output.stdout()) as {
      secret_file: string;
    };
    assert.equal(
      (await readFile(result.secret_file, "utf8")).trim(),
      "whsec_one_time_secret",
    );
    assert.equal((await stat(result.secret_file)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("webhook creation rolls back when secure secret storage fails", async () => {
  const output = outputCollector();
  const directory = await mkdtemp(resolve(tmpdir(), "beatapi-cli-webhook-"));
  const inputPath = resolve(directory, "webhook.json");
  const secretsDirectory = resolve(directory, "secrets");
  await writeFile(
    inputPath,
    JSON.stringify({ url: "https://example.com/webhooks/beatapi" }),
  );
  await mkdir(secretsDirectory, { recursive: true });
  await writeFile(resolve(secretsDirectory, "wh_test.secret"), "existing\n");
  let deletedWebhookId = "";

  try {
    await assert.rejects(
      run(["webhooks", "create", "--file", inputPath], {
        ...output.io,
        apiKey: "sk_test",
        env: { BEATAPI_CONFIG_DIR: directory },
        createClient: () => ({
          createWebhook: async () => ({
            id: "wh_test",
            url: "https://example.com/webhooks/beatapi",
            secret: "whsec_one_time_secret",
          }),
          deleteWebhook: async (id: string) => {
            deletedWebhookId = id;
            return { deleted: true };
          },
        }),
      }),
      /rolled back/,
    );
    assert.equal(deletedWebhookId, "wh_test");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
