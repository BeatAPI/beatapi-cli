# beatapi-client

Official TypeScript client for BeatAPI Model, Data, Workflow, asynchronous
media, and Realtime APIs.

```bash
npm install beatapi-client
```

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
