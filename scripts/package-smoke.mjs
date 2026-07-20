import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "beatapi-packages-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

async function pack(workspace) {
  const { stdout } = await execFileAsync(
    npm,
    [
      "pack",
      "--json",
      "--workspace",
      workspace,
      "--pack-destination",
      temporaryDirectory,
    ],
    { cwd: root },
  );
  const result = JSON.parse(stdout);
  const metadata = Array.isArray(result)
    ? result[0]
    : result[workspace] ?? Object.values(result)[0];
  if (!metadata?.filename) {
    throw new Error(`npm pack did not return metadata for ${workspace}.`);
  }
  return join(temporaryDirectory, metadata.filename);
}

try {
  const clientTarball = await pack("beatapi-client");
  const cliTarball = await pack("beatapi");
  await writeFile(
    join(temporaryDirectory, "package.json"),
    `${JSON.stringify({ private: true }, null, 2)}\n`,
  );
  await execFileAsync(
    npm,
    ["install", "--ignore-scripts", clientTarball, cliTarball],
    { cwd: temporaryDirectory },
  );

  const installedPackage = JSON.parse(
    await readFile(
      join(temporaryDirectory, "node_modules", "beatapi", "package.json"),
      "utf8",
    ),
  );
  if (installedPackage.version !== "0.1.1") {
    throw new Error("Installed CLI package version did not match the release.");
  }

  const executable = join(
    temporaryDirectory,
    "node_modules",
    "beatapi",
    "dist",
    "bin.js",
  );
  const { stdout } = await execFileAsync(process.execPath, [
    executable,
    "--version",
  ]);
  if (stdout.trim() !== installedPackage.version) {
    throw new Error("Installed CLI executable failed its version smoke test.");
  }

  process.stdout.write(
    "Packed beatapi-client and beatapi install and execute successfully.\n",
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
