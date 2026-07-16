# BeatAPI CLI

A dependency-free Node.js command-line client for BeatAPI's public asynchronous
video workflows.

This is an MVP scaffold. It is local-only and marked `private` until command
behavior, package naming, authentication UX, and release ownership are reviewed.

## Requirements

- Node.js 20 or newer
- `BEATAPI_API_KEY` for authenticated commands

```bash
export BEATAPI_API_KEY="sk_your_key"
npm link
beatapi --help
```

## Commands

```bash
beatapi workflows
beatapi usage
beatapi file upload ./input.mp3
beatapi music-video create --json ./music-video.json
beatapi ecommerce-video create --json ./ecommerce-video.json
beatapi task get task_123
beatapi task wait task_123 --interval 7000 --attempts 120
```

Task creation JSON follows the canonical public contract at
`../beatapi-examples/openapi/beatapi.yaml`.

The CLI writes machine-readable result JSON to stdout. Polling progress and
errors go to stderr so commands can be used in scripts.

## Development

```bash
npm run check
npm test
```

