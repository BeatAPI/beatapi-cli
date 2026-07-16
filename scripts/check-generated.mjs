import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const source = join(root, "contract", "beatapi.openapi.yaml");
const committed = join(
  root,
  "packages",
  "client",
  "src",
  "types.generated.ts",
);
const temporaryDirectory = await mkdtemp(join(tmpdir(), "beatapi-types-"));
const generated = join(temporaryDirectory, "types.generated.ts");

try {
  await execFileAsync(
    process.execPath,
    [
      join(root, "node_modules", "openapi-typescript", "bin", "cli.js"),
      source,
      "-o",
      generated,
    ],
    { cwd: root },
  );

  const [expected, actual] = await Promise.all([
    readFile(generated),
    readFile(committed),
  ]);
  if (!expected.equals(actual)) {
    throw new Error(
      "Generated client types are stale. Run `npm run generate:types` and commit the result.",
    );
  }
  process.stdout.write("Generated client types match the bundled OpenAPI contract.\n");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
