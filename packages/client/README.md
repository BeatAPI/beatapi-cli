# beatapi-client

**The professional capability layer for any agent.**

Official JavaScript and TypeScript SDK for BeatAPI model, data, and workflow
APIs, with capability discovery and task polling. Use it in a trusted server,
script, or agent application.

## Install and discover

```bash
npm install beatapi-client
```

```ts
import { BeatAPIClient } from "beatapi-client";

const beatapi = new BeatAPIClient();
const page = await beatapi.searchCapabilities({
  query: "image",
  kind: "model",
  limit: 3,
});

const reference = page.data[0]?.reference;
if (reference) {
  console.log(await beatapi.inspectCapability(reference));
}
```

Search and Inspect are anonymous. Create a key in the
[dashboard](https://beatapi.io/dashboard/apikeys) for execution, then construct
`new BeatAPIClient({ apiKey: process.env.BEATAPI_API_KEY })`. Never expose that
key in browser code.

## Capability methods

| Method | Purpose |
| --- | --- |
| `searchCapabilities(input)` | Discover current models, data APIs, and workflows; use `next_cursor` to paginate |
| `inspectCapability(reference)` | Read the selected input contract and readiness |
| `runCapability(reference, input, { idempotencyKey })` | Execute an inspected capability; a start may spend money |
| `getCapabilityStatus(reference, taskId, view?)` | Read an asynchronous task's status |
| `getCapabilityResult(reference, requestId, view?)` | Read a stored result using its request ID |
| `searchWeb`, `readWebPages`, `mapWebsite`, `researchWeb` | Call the four Web endpoints directly |

Inspect before constructing execution input. Partial contracts require the
[API docs](https://docs.beatapi.io/). Preserve the same idempotency key and input
on retry. Synchronous data results need no polling; async replies include task
and next-step information. See the
[capability guide](https://github.com/BeatAPI/beatapi-cli/blob/main/docs/capabilities.md).

## Media workflow template

This example uses placeholder URLs. Replace them with your own accessible
media. It demonstrates the API shape, not a recorded end-to-end result.

```ts
import { BeatAPIClient } from "beatapi-client";

const beatapi = new BeatAPIClient({
  apiKey: process.env.BEATAPI_API_KEY,
});

const task = await beatapi.createMusicVideoTask({
  images: ["https://example.com/reference.png"],
  audio_url: "https://example.com/song.mp3",
  prompt: "Cinematic nighttime performance.",
});

const result = await beatapi.waitForTask(task.id, {
  intervalMs: 7_000,
  onUpdate: (update) => console.error(update.status),
});

const session = await beatapi.createRealtimeSession(
  {
    max_duration_seconds: 60,
    allowed_origins: ["https://app.example.com"],
  },
  { idempotencyKey: "rt_checkout_123" },
);
```

Create Realtime sessions on a trusted server. Send only the short-lived
`session.client_secret` to the browser SDK; never expose the `sk_` API key.

The exported request and response types are generated from the reviewed
BeatAPI OpenAPI contract. The runtime client preserves structured API errors,
request IDs, retry hints, and supports bounded opt-in retries.

See the [repository](https://github.com/BeatAPI/beatapi-cli) for all methods,
security guidance, and contract verification.

`waitForTask` polls media workflow tasks with bounded retries. For generic
capabilities, poll the returned task with `getCapabilityStatus` instead.

[CLI on npm](https://www.npmjs.com/package/beatapi) ·
[API docs](https://docs.beatapi.io/) ·
[Repository](https://github.com/BeatAPI/beatapi-cli)
