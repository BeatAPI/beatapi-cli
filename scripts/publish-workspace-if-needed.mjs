import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function defaultRun(command, args) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: root,
      encoding: "utf8",
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const stderr =
      typeof error === "object" &&
      error !== null &&
      "stderr" in error &&
      typeof error.stderr === "string"
        ? error.stderr
        : "";
    return {
      exitCode:
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "number"
          ? error.code
          : 1,
      stderr,
      notFound: /\bE404\b|not found/i.test(stderr),
    };
  }
}

async function workspaceMetadata(workspace) {
  const directories = ["packages/client", "packages/cli"];
  for (const directory of directories) {
    const metadata = JSON.parse(
      await readFile(resolve(root, directory, "package.json"), "utf8"),
    );
    if (metadata.name === workspace) return metadata;
  }
  throw new Error(`Unknown npm workspace package: ${workspace}`);
}

export async function publishWorkspaceIfNeeded({
  workspace,
  packageMetadata,
  run = defaultRun,
}) {
  const metadata = packageMetadata ?? (await workspaceMetadata(workspace));
  const packageVersion = `${metadata.name}@${metadata.version}`;
  const lookup = await run("npm", ["view", packageVersion, "version"]);
  if (lookup.exitCode === 0) {
    console.log(`${packageVersion} is already published; skipping.`);
    return "skipped";
  }
  if (!lookup.notFound) {
    throw new Error(
      `Unable to determine whether ${packageVersion} is published.`,
    );
  }

  const published = await run("npm", ["publish", "--workspace", workspace]);
  if (published.exitCode !== 0) {
    throw new Error(`Failed to publish ${packageVersion}.`);
  }
  console.log(`Published ${packageVersion}.`);
  return "published";
}

async function main() {
  const workspace = process.argv[2];
  if (!workspace) {
    throw new Error(
      "Usage: node scripts/publish-workspace-if-needed.mjs <workspace-name>",
    );
  }
  await publishWorkspaceIfNeeded({ workspace });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
