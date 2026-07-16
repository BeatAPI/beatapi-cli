# beatapi-client

Official TypeScript client for the public BeatAPI asynchronous video API.

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
```

The exported request and response types are generated from the reviewed
BeatAPI OpenAPI contract. The runtime client preserves structured API errors,
request IDs, retry hints, and supports bounded opt-in retries.

See the [repository](https://github.com/erickkkyt/beatapi-cli) for all methods,
security guidance, and contract verification.
