# Unified capabilities (0.3.0)

These commands are implemented in this checkout. Publish both `beatapi-client`
and `beatapi` before advertising them as available from npm. Check the installed
`beatapi --version` and `beatapi --help`; 0.2.0 does not have these commands.

## Read-only setup and discovery

```sh
beatapi auth login
beatapi auth status
beatapi capabilities search --query image --kind model --limit 5
beatapi capabilities search --query search --kind data --platform twitter --limit 5
beatapi capabilities search --kind workflow --limit 5
beatapi capabilities inspect <reference-returned-by-search>
```

Login uses hidden terminal input and the OS credential manager. Agents must not
request the key in chat. Search and Inspect are anonymous catalog operations;
they do not validate a key. Use `auth status` for authenticated verification.
Search outputs `{object, data, next_cursor}` (the SDK unwraps the outer REST
`data` envelope once). Use `--cursor` to continue the search. Inspect emits
the actual contract as JSON; partial/unknown contract warnings go to stderr.
Do not assume the first social search result searches posts: inspect its meaning.

## Explicit execution

After inspecting the chosen reference, create an input JSON file matching that
capability's actual schema. If Inspect is partial, consult the official API docs
and OpenAPI first. The CLI does not fabricate, default or certify missing fields.
The file contains only the capability input, not the reference/operation envelope.

```sh
beatapi capabilities run <reference> --file input.json --idempotency-key <unique-request-key>
beatapi capabilities status <same-reference> <returned-task-id> --wait --attempts 60 --interval 5000
```

Angle-bracket values are placeholders, not runnable IDs. A start may spend money;
run it only for an authorized task. A missing idempotency key is generated and
printed to stderr *before* the request. Save and reuse that key and the same input
for a retry. The CLI never automatically retries a start. SDK retries are opt-in
and preserve the supplied key. Both start and status POST to
`/v1/capabilities/run`; status uses `operation: status`, not a separate URL.

Synchronous Data results are returned immediately: do not poll them. For an async
result, use the returned task ID. Waiting stops on success, failure, manual-action
states, unknown states, or the configured attempt limit. A timeout prints the last
result and exits nonzero; resume status lookup, never create a new task to resume.
Each capability HTTP request has a 35-second timeout and rejects redirects.
Read-only status requests may retry transient errors up to three attempts.

All four commands emit JSON to stdout and accept `--output new-file.json`.
Output files use mode 0600 and are never overwritten. JSON is also emitted to
stdout before saving; if saving fails, retain that result, do not restart a task.
Progress/warnings go to stderr. Unknown/duplicate options are rejected.

Existing auth, files upload, workflow, tasks, webhook and realtime commands remain
supported. CLI key storage does not configure an unrelated MCP host's credentials.

## Contract ownership

This additive capability surface follows the gateway's public three-tool manifest
at https://beatapi.io/capabilities-mcp-tools.json and observed REST envelopes.
The existing generated OpenAPI snapshot remains unchanged. Public capability
projections are typed separately and keep incomplete schema fields optional;
they do not claim the gateway provides a complete input or output contract.

Verification: HTTP-boundary tests cover discovery, partial schema handling,
same-key start retries, status routing, synchronous results and bounded polling.
No paid end-to-end result is implied by those tests. Live smoke should first run
Search/Inspect; a real paid example needs its own recorded result and authorization.

### Recorded read-only live example

The built 0.3.0 binary was run against the production API with
`capabilities search --query image --kind model --limit 1`. It returned
`model:gpt-image-2` and cursor `1`. Inspect of that returned reference succeeded
and preserved `validation.state: partial` plus `input_modes: [text, image]`,
printing the missing-contract warning separately from JSON. This proves discovery
and inspection, not image generation. The result ID is an observation, not a
permanent default; search again when performing a user task.
