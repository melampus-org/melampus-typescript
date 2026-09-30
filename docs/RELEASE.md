# Release operations

0.1.0 is an experimental alpha in development. npm publication is separate from
GitHub release creation. The intended package name is `melampus-typescript`;
registry ownership and trusted publishing must be established before publication.

## Reviewed release

1. Update VERSION, package.json, package-lock.json and a matching CHANGELOG.md heading.
2. Run npm run ci and npm run demo. Open a reviewed PR; version-guard validates
   that changed versions exceed existing tags.
3. After the PR merges, Release reruns CI, creates the annotated version tag,
   and attaches the validated npm tarball to a GitHub prerelease. Never tag manually.
4. The workflow is idempotent and refuses a preexisting tag on a different commit.

## npm publication

Configure the npm package's GitHub trusted publisher for organization
`melampus-org`, repository `melampus-typescript`, workflow `publish.yml`, and
GitHub environment `npm`. Permit direct publishing if required by npm's settings.
See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).
The first publication/namespace setup may need an owner-operated bootstrap.

Once configured, manually dispatch Publish npm package from main with an existing
validated release tag. It verifies the release and main ancestry, runs CI, and
publishes the checked tarball with provenance under the `alpha` dist-tag.
No long-lived npm token is stored or copied from the Python repository.

Pages publishes site/ after a merge. Repository protection mirrors the Python
repo: one approval, code-owner review, stale approval dismissal, no deletion or
force pushes, with the existing solo-maintainer admin bypass. CI checks may be
made required after their first successful PR run.

## Evidence and limits

CI runs on Linux with Node 22.18, 24 and 26, and macOS with Node 24. It checks
format/lint, strict types, schema generation, versions, behavioral tests and
coverage, and installs the packed artifact into an isolated consumer. A separate
job validates actual JS exporter evidence using the pinned Python implementation.

No performance overhead target or production readiness is claimed. Checks run
trusted code synchronously and can block or mutate values. Session process groups
provide cleanup, not a security sandbox. See SECURITY.md and PORT.md.
