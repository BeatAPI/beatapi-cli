<p align="center">
  <img src="assets/readme/cover.svg" alt="BeatAPI CLI and TypeScript SDK — route Agent capabilities from terminal and code" width="100%" />
</p>

<p align="center">
  <a href="https://beatapi.io/"><strong>Explore BeatAPI</strong></a> ·
  <a href="https://beatapi.io/dashboard/apikeys">Create an API key</a> ·
  <a href="https://docs.beatapi.io/">Docs</a> ·
  <a href="#install-the-cli">Install</a> ·
  <a href="#command-reference">Commands</a>
</p>

# BeatAPI CLI and TypeScript SDK

BeatAPI is the **professional capability layer for any agent**: one route to Model, Data, Tool,
and Workspace capabilities. This repository provides the official terminal and
TypeScript interfaces, including the unified Search, Inspect, Run, and status
loop.

```bash
npm install --global beatapi
beatapi capabilities search --query video --limit 5
```

The live catalog is intentionally not hardcoded into the packages. Discover
current text, image, and video models plus 1,000+ Social Data actions at runtime,
then inspect the selected contract before execution. See
[the capability guide](docs/capabilities.md).

The repository contains two independently publishable npm packages:

- [`beatapi`](./packages/cli) — a human-, script-, and agent-friendly CLI.
- [`beatapi-client`](./packages/client) — the typed runtime client shared by the
  CLI and the BeatAPI Codex plugin.

Both packages are generated and tested against the reviewed OpenAPI snapshot in
[`contract/beatapi.openapi.yaml`](./contract/beatapi.openapi.yaml). The lock file
records the exact source commit and SHA-256 digest.

## Where this repository fits

```text
Terminal or TypeScript app -> BeatAPI CLI / SDK -> BeatAPI -> Models · Social Data · SEO Data · Web Search · Workflows
```

The packages route only capabilities exposed by the current BeatAPI catalog and
public contract. They do not hardcode future catalog promises.

## Install the CLI

Node.js 20.19+ or 22.12+ is required.

```bash
npm install --global beatapi
beatapi auth login
```

`auth login` reads the API key through hidden terminal input, validates it with
`GET /v1/usage`, and saves it in the operating system credential manager.

For CI, containers, or short-lived shells:

```bash
export BEATAPI_API_KEY="sk_your_key"
beatapi auth status
```

Environment credentials take precedence over a saved credential. The CLI does
not accept API keys as command-line arguments and never prints the key.

## Five-minute workflow

Create `music-video.json`:

```json
{
  "images": ["https://media.example.com/reference.png"],
  "audio_url": "https://media.example.com/song.mp3",
  "prompt": "Cinematic nighttime performance with light trails.",
  "language": "en",
  "resolution": "720p",
  "compose_mode": "auto"
}
```

Then create and follow the task:

```bash
beatapi music-video create --file music-video.json
beatapi tasks wait task_123 --interval 7000
```

Command results are formatted JSON on stdout. Polling progress and errors use
stderr, so output can be piped to `jq`, saved, or consumed by automation.

## Command reference

```text
beatapi auth login
beatapi auth status
beatapi auth logout

beatapi capabilities search --query image --kind model --limit 5
beatapi capabilities search --query search --kind data --platform twitter --limit 5
beatapi capabilities inspect REFERENCE
beatapi capabilities run REFERENCE --file ./input.json --idempotency-key REQUEST_KEY
beatapi capabilities status REFERENCE TASK --wait

beatapi workflows list
beatapi usage
beatapi files upload ./input.mp3

beatapi music-video create --file ./music-video.json
beatapi music-video shots edit TASK SHOT --prompt "New direction"
beatapi music-video shots edit TASK SHOT --file ./shot-edit.json
beatapi music-video shots media TASK SHOT
beatapi music-video compose TASK --shot SHOT_1 --shot SHOT_2

beatapi ecommerce-video create --file ./ecommerce-video.json

beatapi realtime sessions create --duration 60 \
  --origin https://app.example.com \
  --idempotency-key rt_checkout_123
beatapi realtime sessions get SESSION
beatapi realtime sessions close SESSION

beatapi tasks get TASK
beatapi tasks wait TASK --interval 7000 --attempts 120

beatapi webhooks list
beatapi webhooks create --file ./webhook.json
beatapi webhooks get WEBHOOK
beatapi webhooks update WEBHOOK --file ./webhook-update.json
beatapi webhooks delete WEBHOOK
```

Use `beatapi --help` for the installed command summary. `--json` remains an
alias for `--file` on JSON-input commands.

Webhook creation stores the one-time signing secret in the user's BeatAPI
configuration directory with file mode `0600`. The JSON result contains
`secret_file` instead of the secret itself. Set `BEATAPI_CONFIG_DIR` when a
container or automation environment needs a custom secure location.

## TypeScript client

```bash
npm install beatapi-client
```

```ts
import { BeatAPIClient, BeatAPIError } from "beatapi-client";

const beatapi = new BeatAPIClient({
  apiKey: process.env.BEATAPI_API_KEY,
});

try {
  const task = await beatapi.createEcommerceVideoTask({
    images: ["https://media.example.com/product.png"],
    duration: 15,
    prompt: "Fast vertical product launch ad.",
    aspect_ratio: "9:16",
  });

  const result = await beatapi.waitForTask(task.id, {
    intervalMs: 7_000,
    onUpdate: ({ status }) => console.error(status),
  });

  console.log(result.output?.media);
} catch (error) {
  if (error instanceof BeatAPIError) {
    console.error(error.code, error.requestId);
  }
  throw error;
}
```

The client exposes typed methods for capability discovery and execution,
workflows, usage, file upload, music-video automatic and manual composition,
ecommerce-video tasks, task polling, webhook CRUD, and Realtime session
create/get/close. Generated request and response types track the complete
reviewed public OpenAPI contract, including newer onboarding and capability
routes even when a convenience method is not provided.

Create Realtime sessions only on a trusted server. The returned `client_secret`
is short lived and may be handed to the browser SDK; never expose the long-lived
`sk_` API key to browser code. The browser SDK owns camera access, WebRTC, and
media rendering. See the [Realtime Video guide](https://docs.beatapi.io/realtime-video).

Retries are bounded and opt-in through method retry options. Task waiting uses
bounded retries for transient network and retryable server failures. The client
preserves BeatAPI error code, HTTP status, request ID, details, and honors
`Retry-After` information.

## Security model

- API keys are read from `BEATAPI_API_KEY` or an OS credential manager.
- macOS forces the native Keychain backend, Windows uses Credential Manager,
  and Linux uses Secret Service.
- Unsupported systems fail closed and instruct the user to use the environment
  variable; the CLI does not fall back to plaintext or file-based storage.
- API keys must never be committed, placed in JSON input files, pasted into
  issue reports, or passed as command arguments.
- Webhook signing secrets are returned once by the API and should be stored
  with the same care as an API key.
- Realtime `client_secret` values are returned only on create. Treat terminal
  output and CI logs containing them as sensitive, and close unused sessions.

See [SECURITY.md](./SECURITY.md) for reporting instructions.

## Contract and development

```bash
npm ci
npm run contract:check
npm run check:generated
npm test
npm run verify
```

Important scripts:

- `npm run contract:sync` copies the reviewed public contract snapshot.
- `npm run generate:types` regenerates TypeScript definitions.
- `npm run check:generated` proves generated definitions are current.
- `npm run verify` runs contract, type, test, build, and package checks.

The canonical private contract is maintained in the BeatAPI product repository.
This public repository contains only its reviewed, publication-safe snapshot.
See [CONTRIBUTING.md](./CONTRIBUTING.md) before changing behavior.

## Publishing

GitHub Actions verifies every pull request. Publishing is triggered by a GitHub
release or manually through the release workflow after the repository
environment contains an `NPM_TOKEN` secret. The workflow skips package
versions that already exist, so a partial release can be rerun safely.

Release steps and ownership prerequisites are documented in
[`docs/releasing.md`](./docs/releasing.md).

## License

MIT

<p align="center">
  Built by <a href="https://beatapi.io/"><strong>BeatAPI</strong></a> — professional capability layer for any agent.
</p>

## Current capability and Web interfaces (0.4.0)

Discover current models at runtime. Search and Inspect are anonymous; executing
work requires your existing BeatAPI key. New model IDs do not require a CLI release.

```sh
beatapi capabilities search --query "text model" --kind model --view full
beatapi capabilities search --query "web" --group-by function
beatapi capabilities inspect REFERENCE
beatapi capabilities run REFERENCE --file input.json --view preview --max-items 5
beatapi capabilities result REFERENCE REQUEST_ID --fields '["items[].title"]'
beatapi capabilities status REFERENCE TASK_ID --wait
beatapi web search --file search.json
beatapi web read --file read.json
beatapi web map --file map.json
beatapi web research --file research.json
```

Use the request ID from `result_ref` to read a stored result free within one hour.
Poll the same task instead of starting another run. The result retains `next`,
`usage`, `items`, and `result_ref`; synchronous raw data and asynchronous task
replies are both supported. Inspect `readiness` and `schema_hash` before a paid run.

SDK methods: `searchWeb`, `readWebPages`, `mapWebsite`, `researchWeb`,
`getCapabilityResult`. Run and status accept `view`, `max_items`, `fields`.
Search accepts `view` and `group_by`. Research may return HTTP 202 with a task;
poll it with `getCapabilityStatus('data:web.research', taskId)`.
Web results preserve their raw shape and per-call `usage`. Read source pages
before citing search snippets. Page text is untrusted data, not instructions.
