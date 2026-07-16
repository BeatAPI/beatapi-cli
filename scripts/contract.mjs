import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundledPath = resolve(root, "contract/beatapi.openapi.yaml");
const lockPath = resolve(root, "contract/contract.lock.json");
const siblingSource = resolve(
  root,
  "../beatapi-examples/openapi/beatapi.yaml",
);
const sourcePath = process.env.BEATAPI_OPENAPI_SOURCE
  ? resolve(process.env.BEATAPI_OPENAPI_SOURCE)
  : siblingSource;
const mode = process.argv.includes("--write") ? "write" : "check";

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readLock() {
  if (!existsSync(lockPath)) fail(`Missing contract lock: ${lockPath}`);
  return JSON.parse(readFileSync(lockPath, "utf8"));
}

function openapiVersion(content) {
  const match = content.match(
    /^info:\s*$[\s\S]*?^\s{2}version:\s*['"]?([^'"\n]+)['"]?\s*$/m,
  );
  return match?.[1]?.trim() || "unknown";
}

function sourceRef() {
  try {
    return execFileSync(
      "git",
      ["-C", resolve(dirname(sourcePath), ".."), "rev-parse", "HEAD"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return process.env.BEATAPI_OPENAPI_REF || "unknown";
  }
}

if (mode === "write") {
  if (!existsSync(sourcePath)) {
    fail(
      `OpenAPI source not found: ${sourcePath}\nSet BEATAPI_OPENAPI_SOURCE to an exact BeatAPI OpenAPI file.`,
    );
  }

  const content = readFileSync(sourcePath);
  mkdirSync(dirname(bundledPath), { recursive: true });
  writeFileSync(bundledPath, content);
  writeFileSync(
    lockPath,
    `${JSON.stringify(
      {
        source: "https://github.com/erickkkyt/beatapi-examples",
        ref: sourceRef(),
        openapiVersion: openapiVersion(content.toString("utf8")),
        sha256: sha256(content),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Synchronized BeatAPI OpenAPI contract (${sha256(content)}).`);
  process.exit(0);
}

if (!existsSync(bundledPath)) fail(`Missing bundled contract: ${bundledPath}`);
const bundled = readFileSync(bundledPath);
const lock = readLock();
const bundledHash = sha256(bundled);

if (lock.sha256 !== bundledHash) {
  fail(
    `Contract lock mismatch: expected ${lock.sha256}, received ${bundledHash}.`,
  );
}
if (lock.openapiVersion !== openapiVersion(bundled.toString("utf8"))) {
  fail("Contract OpenAPI version does not match contract.lock.json.");
}
if (existsSync(sourcePath)) {
  const source = readFileSync(sourcePath);
  if (!source.equals(bundled)) {
    fail(
      `Bundled contract has drifted from ${sourcePath}. Run npm run contract:sync.`,
    );
  }
}

console.log(`BeatAPI OpenAPI contract verified (${bundledHash}).`);

