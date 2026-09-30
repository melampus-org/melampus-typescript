# Contributing

Use Node.js 22.18+ and npm. Develop on a branch in a dedicated checkout or
worktree; preserve other sessions' work. Main changes through reviewed PRs.

```sh
npm ci
npm run ci
npm run demo
```

`npm run format` edits formatting; `npm run lint` is read-only. CI uses the
committed lockfile. Tests cover real subprocess supervision and HTTP export;
coverage includes disposable runners. Package checks install the actual tarball
in a temporary consumer and run the shipped scenario outside node_modules.

Wire names originate in `semconv/code_artifact.yaml`. Run
`node scripts/generate-semconv.mjs` after reviewed changes. Coordinate wire
changes with melampus-python, bump the wire schema for incompatible changes,
and update golden fixtures and both producer/consumer checks. Never treat
suppression as success or add raw application content to telemetry.

Keep the SDK entry point API-only. Applications configure OTel. Preserve sync
return types, async rejection identity and receiver binding. Session scenarios
are trusted code, not a sandbox.

Version changes update VERSION, package.json, package-lock.json and CHANGELOG.md.
Do not tag manually; use the reviewed release workflow. See docs/RELEASE.md.
