import assert from "node:assert/strict";
import test from "node:test";

let publishWorkspaceIfNeeded;
try {
  ({ publishWorkspaceIfNeeded } = await import(
    "../scripts/publish-workspace-if-needed.mjs"
  ));
} catch {
  // The first TDD run proves the publishing adapter does not exist yet.
}

test("skips a workspace version that already exists on npm", async () => {
  assert.ok(
    publishWorkspaceIfNeeded,
    "publishWorkspaceIfNeeded must be implemented",
  );
  const calls = [];

  const result = await publishWorkspaceIfNeeded({
    workspace: "beatapi-client",
    packageMetadata: {
      name: "beatapi-client",
      version: "0.1.0",
    },
    run: async (command, args) => {
      calls.push([command, ...args]);
      return { exitCode: 0 };
    },
  });

  assert.equal(result, "skipped");
  assert.deepEqual(calls, [
    ["npm", "view", "beatapi-client@0.1.0", "version"],
  ]);
});

test("publishes a workspace version that does not exist on npm", async () => {
  assert.ok(
    publishWorkspaceIfNeeded,
    "publishWorkspaceIfNeeded must be implemented",
  );
  const calls = [];

  const result = await publishWorkspaceIfNeeded({
    workspace: "beatapi",
    packageMetadata: {
      name: "beatapi",
      version: "0.1.0",
    },
    run: async (command, args) => {
      calls.push([command, ...args]);
      return calls.length === 1
        ? { exitCode: 1, notFound: true }
        : { exitCode: 0 };
    },
  });

  assert.equal(result, "published");
  assert.deepEqual(calls, [
    ["npm", "view", "beatapi@0.1.0", "version"],
    ["npm", "publish", "--workspace", "beatapi"],
  ]);
});
