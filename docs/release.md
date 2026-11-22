# Release the kit

How the five public packages and the app host program image are released. The short form is in
the [README](../README.md#how-a-change-is-released).

A `v<version>` tag on master, or a manual dispatch, runs `.github/workflows/release.yml`. The tag
must be the version of one package. The workflow runs `verify`, then publishes every package
version not yet on npm, using OIDC trusted publishing with provenance. It skips private packages.

The same run builds the app host program image from `packages/apphost/Dockerfile`. It pushes
`ghcr.io/agentage/platform/apphost:<version>` and a tag of the commit. Then it uploads the record
`agentage-apphost.json` to the release `@agentage/apphost@<version>`. This job needs only
`verify`, so a held npm publish does not stop it. It does nothing when the record is already on
the release. A re-run records the image that it pushed before. It refuses a version tag with
another digest. The decision and the record are in `packages/apphost/scripts/image-release.mjs`.

Before that, CI builds [the probe extension](https://github.com/agentage/examples) on the
packed packages, runs `up`, and checks every part image and the served discovery document. A kit
change is proven in containers before it ships.

## Before the next release

The repo is now `agentage/kit` (it was `agentage/platform`). npm provenance and trusted publishing match the repo and the workflow file, so the owner must change the trusted publisher on npmjs.com of each of the five packages (`@agentage/extension`, `@agentage/apphost`, `@agentage/identity`, `@agentage/shell-dashboard`, `@agentage/widget`) to repository `agentage/kit` and workflow `release.yml` before the next kit release. The program image name stays `ghcr.io/agentage/platform/apphost`: old release records name it.

## When a release run fails

Run the failed run of the tag again (`gh run rerun <id> -R agentage/kit`). Do not open a
version-only PR: CI refuses a package version that moves with no other change in that package
(`scripts/check-bumps.mjs`). A second attempt is safe:

- it passes the "release already exists" guard, which stops only a first attempt;
- the publish step skips each version that is already on npm, so it publishes only what is missing;
- a package whose `@agentage` dependency is not on npm yet waits, and the next attempt publishes it.

A version that the run staged (`STAGED for approval` in the log) needs the owner: approve or discard
it on npmjs.com, then run the attempt again. A run that failed in `Verify` on a known flaky test is
the same case. A real defect is a fix PR with a new version; that PR changes the package, so the
check passes.

## First publish of a new package name

A name that is not on npm yet has no trusted publisher, and `release.yml` has no token: its publish
and its stage both fail. When npm answers 404 for the name, the run holds it with "new package
name: first publish needs the owner". The owner gives the name a trusted publisher; the pipeline
then publishes the real version (done this way for `@agentage/apphost` and
`@agentage/shell-dashboard`, 2026-11-19):

1. Publish a placeholder by hand: a two-file package (`package.json` and `README.md`) at version
   `0.0.0-bootstrap.0`, `npm publish --access public --tag bootstrap`. On a first publish npm also
   points `latest` at it, until the real version is published. The trusted publisher was added on
   the name with this placeholder; a name with no version was not tried. A hand publish of
   `0.0.0-stage` is refused with 403 ("You cannot publish using the version"), but npm lists a
   `0.0.0-stage` version on the name anyway (as on four older `@agentage` packages): use
   `0.0.0-bootstrap.0`.
2. Add the trusted publisher with publish allowed:
   `npx npm@12 trust github <name> --repo agentage/kit --file release.yml --allow-publish --yes`.
   Without `--allow-publish` it is stage-only, and each release needs the owner again. A new
   trusted publisher expires if it does not publish within 2 days; then remove it and add it again.
3. Run the tag run again. It skips every version already on npm and publishes the new name.
4. Wait for the registry: a new version took about 3 minutes to show in `npm view`. Until the real
   version shows, `latest` may still name the placeholder; check `npm view <name> dist-tags`.

Cleanup (optional, any time, the owner): deprecate the placeholder versions and remove the
`bootstrap` dist-tag of each new name:

```
npm deprecate <name>@0.0.0-bootstrap.0 "placeholder for the first trusted publish"
npm deprecate <name>@0.0.0-stage "placeholder for the first trusted publish"
npm dist-tag rm <name> bootstrap
```
