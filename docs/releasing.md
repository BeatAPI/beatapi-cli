# Release guide

## One-time setup

1. Use the public GitHub repository `BeatAPI/beatapi-cli`.
2. Log in to npm with the BeatAPI publishing account.
3. Publish or reserve both package names: `beatapi-client` and `beatapi`.
4. In GitHub, create an environment named `npm`.
5. Add the publishing owner as a required reviewer for the `npm` environment
   and allow release tags matching `v*`.
6. On npmjs.com, configure a GitHub Actions Trusted Publisher separately for
   `beatapi-client` and `beatapi` with these exact values:
   - organization: `BeatAPI`;
   - repository: `beatapi-cli`;
   - workflow filename: `release.yml`;
   - environment: `npm`;
   - allowed action: `npm publish`.

The release workflow uses npm Trusted Publishing over OIDC. It intentionally
does not store or reference a long-lived `NPM_TOKEN`. GitHub grants the workflow
a short-lived identity for each approved release, and npm automatically records
provenance for public packages published from the public repository.

The package names were unregistered when this repository was prepared. npm
names are first-come, first-served, so reserve them before announcing the
release.

## Release checklist

1. Synchronize and review the public OpenAPI snapshot.
2. Run `npm run verify` from a clean checkout.
3. Confirm `npm audit --omit=dev` reports no known runtime vulnerabilities.
4. Update `CHANGELOG.md` and both package versions together.
5. Commit and push the release branch.
6. Merge to `main` only after CI passes.
7. Create a GitHub release tagged `vX.Y.Z`.
8. Approve the protected `npm` environment deployment.
   The workflow checks each exact package version before publishing, so it is
   safe to rerun after one package succeeds and the other fails.
9. Confirm both npm package pages and install the CLI in a clean temporary
   directory.
10. Run `beatapi --version`, `beatapi --help`, and an authenticated
    `beatapi auth status` smoke test.

The workflow installs the current npm CLI on Node.js 24 because Trusted
Publishing requires npm 11.5.1 or newer and Node.js 22.14.0 or newer. Do not add
an `NPM_TOKEN` fallback: a missing OIDC trust relationship should fail closed
instead of silently using a persistent credential.

## Rollback

npm package versions are immutable. If a release is defective:

1. Deprecate the affected version with a clear message.
2. Publish a corrected patch release.
3. Mark the GitHub release as superseded and link to the patch.
4. Revoke any credential that may have entered logs or artifacts.
