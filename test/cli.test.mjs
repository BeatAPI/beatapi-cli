import assert from "node:assert/strict";
import test from "node:test";
import { run } from "../src/cli.mjs";

test("prints help without requiring an API key", async () => {
  let output = "";
  await run(["--help"], { stdout: (text) => (output += text) });
  assert.match(output, /BeatAPI CLI 0\.1\.0/);
  assert.match(output, /music-video create/);
});

test("lists workflows using the anonymous client method", async () => {
  const client = {
    listWorkflows: async () => [{ slug: "music-video" }],
  };
  let output = "";
  await run(["workflows"], {
    client,
    stdout: (text) => (output += text),
  });
  assert.match(output, /music-video/);
});

test("creates a music-video task from JSON", async () => {
  const client = {
    createMusicVideoTask: async (input) => ({
      id: "task_test",
      prompt: input.prompt,
    }),
  };
  const fixtureUrl = new URL("./music-video.json", import.meta.url);
  let output = "";
  await run(["music-video", "create", "--json", fixtureUrl.pathname], {
    client,
    stdout: (text) => (output += text),
  });
  assert.match(output, /task_test/);
  assert.match(output, /test prompt/);
});
