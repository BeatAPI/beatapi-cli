# beatapi

Official BeatAPI command-line interface for people, scripts, and AI agents.

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
```

Results are JSON on stdout. Progress and errors use stderr so the CLI composes
cleanly with shell scripts and automation tools.

Webhook creation writes the one-time signing secret to a mode-`0600` file and
returns its path as `secret_file`; it does not print the secret.

See the [repository](https://github.com/erickkkyt/beatapi-cli) for the complete
command reference and security model.
