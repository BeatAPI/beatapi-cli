import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/release.yml", import.meta.url),
  "utf8",
);

test("publishes both packages through approval-gated OIDC", () => {
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /environment:\s*npm/);
  assert.match(workflow, /node-version:\s*24/);
  assert.match(workflow, /npm install --global npm@latest/);
  assert.match(
    workflow,
    /publish-workspace-if-needed\.mjs beatapi-client[\s\S]*publish-workspace-if-needed\.mjs beatapi/,
  );
  assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN/);
});
