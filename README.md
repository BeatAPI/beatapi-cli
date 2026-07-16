# BeatAPI CLI and TypeScript Client

Official command-line interface and TypeScript client for BeatAPI's public
asynchronous AI video workflows.

The repository contains two independently publishable npm packages:

- [`beatapi`](./packages/cli) — a human-, script-, and agent-friendly CLI.
- [`beatapi-client`](./packages/client) — the typed runtime client shared by the
  CLI and the BeatAPI Codex plugin.

Both packages are generated and tested against the reviewed OpenAPI snapshot in
[`contract/beatapi.openapi.yaml`](./contract/beatapi.openapi.yaml). The lock file
records the exact source commit and SHA-256 digest.

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

beatapi workflows list
beatapi usage
beatapi files upload ./input.mp3

beatapi music-video create --file ./music-video.json
beatapi music-video shots edit TASK SHOT --prompt "New direction"
beatapi music-video shots edit TASK SHOT --file ./shot-edit.json
beatapi music-video shots media TASK SHOT
beatapi music-video compose TASK --shot SHOT_1 --shot SHOT_2

beatapi ecommerce-video create --file ./ecommerce-video.json

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

The client exposes every launch-contract operation: workflows, usage, file
upload, music-video automatic and manual composition, ecommerce-video tasks,
task polling, and webhook CRUD.

Retries are bounded and opt-in through method retry options. The client
preserves BeatAPI error code, HTTP status, request ID, details, and
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
environment contains an `NPM_TOKEN` secret.

Release steps and ownership prerequisites are documented in
[`docs/releasing.md`](./docs/releasing.md).

## License

MIT
