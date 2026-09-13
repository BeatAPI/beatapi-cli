# Changelog

All notable changes to this project will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Prepare 0.3.0: unified capabilities Search, Inspect, Run and status in the
  shared client and CLI, preserving existing commands.
- Anonymous discovery, partial-contract warnings, stable start idempotency keys,
  bounded status polling, non-overwriting JSON output and structured API errors.
- HTTP-boundary tests and a live read-only Search/Inspect smoke check.

### Fixed

- Update the development YAML parser to 4.3.2; dependency audit reports no known vulnerabilities.

## [0.2.0] - 2026-07-31

### Added

- Type-safe Realtime session create, get, and close methods in
  `beatapi-client`.
- Realtime session commands in the `beatapi` CLI with required origin,
  duration, and idempotency semantics.
- Realtime Video documentation and explicit API key/client secret boundaries.

### Changed

- Synchronize generated types and the contract lock to the current public
  BeatAPI OpenAPI baseline.

## [0.1.1] - 2026-07-20

### Changed

- Publish both npm packages from GitHub Actions through npm Trusted Publishing
  and short-lived OIDC credentials instead of a long-lived automation token.
- Add an approval-gated `npm` deployment environment and automatic npm
  provenance for future releases.
- Normalize the CLI binary path in the published package metadata.

## [0.1.0] - 2026-07-17

### Added

- Type-safe `beatapi-client` generated from the reviewed BeatAPI OpenAPI
  contract.
- `beatapi` CLI with secure login, JSON output, and stderr progress.
- Music Video automatic and manual shot workflows.
- Ecommerce Video task creation and asynchronous task polling.
- File upload, usage, workflow discovery, and webhook CRUD commands.
- Structured errors, request IDs, bounded retries, CI, package checks, and npm
  release automation.

[Unreleased]: https://github.com/BeatAPI/beatapi-cli/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/BeatAPI/beatapi-cli/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/BeatAPI/beatapi-cli/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/BeatAPI/beatapi-cli/releases/tag/v0.1.0
