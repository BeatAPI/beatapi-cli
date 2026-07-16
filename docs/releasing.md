# Release guide

## One-time setup

1. Create the public GitHub repository `erickkkyt/beatapi-cli`.
2. Log in to npm with the BeatAPI publishing account.
3. Publish or reserve both package names: `beatapi-client` and `beatapi`.
4. In GitHub, create an environment named `npm`.
5. Add an environment secret named `NPM_TOKEN` with publish access to both
   packages. Keep required reviewer protection enabled for production releases.

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
9. Confirm both npm package pages and install the CLI in a clean temporary
   directory.
10. Run `beatapi --version`, `beatapi --help`, and an authenticated
    `beatapi auth status` smoke test.

## Rollback

npm package versions are immutable. If a release is defective:

1. Deprecate the affected version with a clear message.
2. Publish a corrected patch release.
3. Mark the GitHub release as superseded and link to the patch.
4. Revoke any credential that may have entered logs or artifacts.
