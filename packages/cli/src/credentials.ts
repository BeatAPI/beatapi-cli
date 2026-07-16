export interface CredentialStore {
  get(): Promise<string | null>;
  set(apiKey: string): Promise<void>;
  delete(): Promise<void>;
}

interface KeychainModule {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(
    service: string,
    account: string,
    password: string,
  ): Promise<void>;
  deletePassword(service: string, account: string): Promise<unknown>;
}

export interface CreateCredentialStoreOptions {
  platform?: NodeJS.Platform | string;
  service?: string;
  account?: string;
  loadKeychain?: (backend: string) => Promise<KeychainModule>;
}

export interface ResolveApiKeyOptions {
  env?: Record<string, string | undefined>;
  store: CredentialStore;
}

export interface ResolvedApiKey {
  apiKey: string;
  source: "environment" | "credential-store";
}

const PLATFORM_BACKENDS: Readonly<Record<string, string>> = {
  darwin: "native-macos",
  linux: "secret-service",
  win32: "windows",
};

async function loadNativeKeychain(backend: string): Promise<KeychainModule> {
  const keychain = await import("cross-keychain");
  await keychain.useBackend(backend);
  return keychain;
}

export function createCredentialStore(
  options: CreateCredentialStoreOptions = {},
): CredentialStore {
  const platform = options.platform ?? process.platform;
  const backend = PLATFORM_BACKENDS[platform];
  const service = options.service ?? "io.beatapi.cli";
  const account = options.account ?? "default";
  const loadKeychain = options.loadKeychain ?? loadNativeKeychain;

  async function keychain(): Promise<KeychainModule> {
    if (!backend) {
      throw new Error(
        `Secure credential storage is not available on ${platform}. Set BEATAPI_API_KEY for this session instead.`,
      );
    }
    return loadKeychain(backend);
  }

  return {
    async get() {
      return (await keychain()).getPassword(service, account);
    },
    async set(apiKey) {
      await (await keychain()).setPassword(service, account, apiKey);
    },
    async delete() {
      await (await keychain()).deletePassword(service, account);
    },
  };
}

export async function resolveApiKey(
  options: ResolveApiKeyOptions,
): Promise<ResolvedApiKey | null> {
  const envKey = options.env?.BEATAPI_API_KEY?.trim();
  if (envKey) return { apiKey: envKey, source: "environment" };

  const storedKey = (await options.store.get())?.trim();
  if (!storedKey) return null;
  return { apiKey: storedKey, source: "credential-store" };
}
