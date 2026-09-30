# Agent instructions

Work on a task branch in an isolated checkout; do not commit directly on main.
Preserve changes belonging to other agents. Keep the core SDK API-only and wire
schema compatible with the Python reference documented in docs/PORT.md.

Run npm run ci and npm run demo before proposing a release. For release changes,
update VERSION, package.json, package-lock.json and CHANGELOG.md together.
Never manually create tags or publish npm without an explicit release request.
Keep claims about coverage, publishing and performance tied to observed evidence.
