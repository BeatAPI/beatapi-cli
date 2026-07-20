# Changelog

All notable changes to this project will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/BeatAPI/beatapi-cli/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/BeatAPI/beatapi-cli/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/BeatAPI/beatapi-cli/releases/tag/v0.1.0
