import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

type Environment = Record<string, string | undefined>;

function secretDirectory(env: Environment): string {
  if (env.BEATAPI_CONFIG_DIR?.trim()) {
    return resolve(env.BEATAPI_CONFIG_DIR.trim(), "secrets");
  }
  if (process.platform === "win32" && env.APPDATA?.trim()) {
    return resolve(env.APPDATA.trim(), "BeatAPI", "secrets");
  }
  if (env.XDG_CONFIG_HOME?.trim()) {
    return resolve(env.XDG_CONFIG_HOME.trim(), "beatapi", "secrets");
  }
  return resolve(homedir(), ".config", "beatapi", "secrets");
}

function secretFilename(endpoint: Record<string, unknown>): string {
  const id =
    typeof endpoint.id === "string"
      ? endpoint.id.replace(/[^A-Za-z0-9._-]/g, "-")
      : "";
  return `${id || `webhook-${Date.now()}`}.secret`;
}

export async function persistWebhookSecret(
  endpoint: Record<string, unknown>,
  env: Environment = process.env,
): Promise<Record<string, unknown>> {
  const secret = endpoint.secret;
  if (typeof secret !== "string" || !secret || secret.includes("masked")) {
    throw new Error("BeatAPI did not return a usable one-time webhook secret.");
  }

  const directory = secretDirectory(env);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = resolve(directory, secretFilename(endpoint));
  await writeFile(path, `${secret}\n`, { mode: 0o600, flag: "wx" });
  await chmod(path, 0o600);

  const { secret: _secret, ...safeEndpoint } = endpoint;
  return { ...safeEndpoint, secret_file: path };
}
