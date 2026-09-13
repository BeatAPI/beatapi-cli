# beatapi

Official BeatAPI command-line interface for people, scripts, and AI agents.

The 0.3.0 source adds unified capability commands (check the installed `--help`
and npm availability before use):

```sh
beatapi capabilities search --query image --kind model --limit 5
beatapi capabilities inspect <reference-returned-by-search>
beatapi capabilities run <inspected-reference> --file input.json --idempotency-key <unique-task-key>
beatapi capabilities status <same-reference> <returned-task-id> --wait
```

Search/Inspect are anonymous and do not validate the key. Run `auth status` for
that. Partial contracts require the official API docs; the CLI never fills missing
parameters. Starts may spend money. Reuse the same idempotency key/input on retry.
Synchronous Data results return immediately and need no polling. All capability
commands support `--output <new-file.json>` without overwriting existing files.
See the [capability guide](https://github.com/BeatAPI/beatapi-cli/blob/main/docs/capabilities.md).

```bash
npm install --global beatapi
beatapi auth login
beatapi workflows list
```

The login command validates the key before storing it in the operating
system's credential manager. For CI and short-lived shells, set
`BEATAPI_API_KEY` instead.

```bash
beatapi music-video create --file music-video.json
beatapi tasks wait task_123 --interval 7000
beatapi realtime sessions create --duration 60 \
  --origin https://app.example.com \
  --idempotency-key rt_checkout_123
```

Results are JSON on stdout. Progress and errors use stderr so the CLI composes
cleanly with shell scripts and automation tools.

Webhook creation writes the one-time signing secret to a mode-`0600` file and
returns its path as `secret_file`; it does not print the secret.

Realtime session creation prints the API result, including its one-time,
short-lived `client_secret`. Run it only in a trusted terminal, avoid CI log
capture, pass only that secret to the browser SDK, and never expose an `sk_`
API key in browser code.

See the [repository](https://github.com/BeatAPI/beatapi-cli) for the complete
command reference and security model.
