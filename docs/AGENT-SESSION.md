# Local agent sessions

Start the supervisor in the scenario project and keep it running:

```sh
node /path/to/melampus-typescript/dist/cli.js session --config melampus.json
```

A JSON configuration identifies reviewed contracts, a scenario, and repair scope:

```json
{
  "contracts": "intent.ts",
  "probe": "exercise.ts",
  "watch": ["pricing.ts"],
  "protect": ["package.json"],
  "timeout": 5
}
```

The config, contract module and probe are always protected. List additional
reviewed imports, lockfiles, agent instructions and hook configuration in protect.
Watch all implementation dependencies needed for the scenario. Unlisted files
are outside the freshness claim. Paths must stay within the config's directory;
symlinks are rejected. Recursive watches skip generated and dependency folders.

The contract module exports a nonempty CONTRACTS object keyed by the exact SDK
path. Each value is a Contract with unsampled checks. The probe imports and
executes the implementation. Missing instrumentation, replaced predicates,
missing executions, check errors, crashes, timeouts, protected-file changes and
source changes during a run are incomplete. A failed boolean predicate is drift.

The gate queries a token-authenticated loopback process. Saved state locates the
process; saved reports never authorize progress. Polling runs every 0.5 seconds;
each gate request checks current content again. The state file has mode 0600.
Only one supervisor can own its state path. Normal SIGINT/SIGTERM cleans up state
and lock; after a crash, verify the PID in `.melampus/session.json.lock/owner.json`
is no longer alive, then remove that stale lock directory before restarting.
A dead supervisor always closes the gate even if its state file remains.

`melampus gate` prints a report and exits 0/1/2. `melampus hook` reads Claude Code
hook input and emits a JSON decision with exit 0; malformed input exits 2.
PreToolUse allows reads and scoped repairs; drift denies other progression tools.
PostToolUse/Stop block on incomplete or drifting state. Even while healthy,
Edit/Write outside the repair scope is denied. This is a cooperative workflow,
not an OS boundary; shell commands and other tools are not sandboxed.

Hook decisions follow the [Claude Code reference](https://code.claude.com/docs/en/hooks).
Enable synchronous hooks; the included 30-second host timeout exceeds the client's
25-second request deadline. Host cancellation or disabled hooks can prevent a
verdict. Hooks neither launch nor pay for a model, interrupt unfinished tokens,
roll back edits, nor control concurrent agents.

Tests remain useful for broad regression coverage. A session adds automatic
freshness checks and an agent gate around reviewed executable claims. A green
session says only that its exercised inputs satisfied those claims.
