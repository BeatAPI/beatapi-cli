import assert from "node:assert/strict";
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
