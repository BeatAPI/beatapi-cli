import assert from "node:assert/strict";
import test from "node:test";

import {
  createCredentialStore,
  resolveApiKey,
} from "../src/credentials.js";

test("environment API key overrides the system credential store", async () => {
  let reads = 0;
  const store = {
    async get() {
      reads += 1;
      return "sk_saved";
    },
    async set() {},
    async delete() {},
  };

  const resolved = await resolveApiKey({
    env: { BEATAPI_API_KEY: "sk_environment" },
    store,
  });

  assert.equal(resolved?.apiKey, "sk_environment");
  assert.equal(resolved?.source, "environment");
  assert.equal(reads, 0);
});

test("system credential storage forces a native backend", async () => {
  let selectedBackend = "";
  const store = createCredentialStore({
    platform: "darwin",
    loadKeychain: async (backend) => {
      selectedBackend = backend;
      return {
        getPassword: async () => "sk_saved",
        setPassword: async () => undefined,
        deletePassword: async () => true,
      };
    },
  });

  assert.equal(await store.get(), "sk_saved");
  assert.equal(selectedBackend, "native-macos");
});

test("unsupported native keychain does not fall back to plaintext files", async () => {
  const store = createCredentialStore({
    platform: "freebsd",
    loadKeychain: async () => {
      throw new Error("must not load");
    },
  });

  await assert.rejects(store.get(), /BEATAPI_API_KEY/);
});

