# Pricing repair example

`pricing.ts` contains plain business logic. `registration.ts` registers the module
object once with PRICE; `exercise.ts` calls through that object. The registration
and reviewed claims are protected while the agent repairs pricing.ts.

From the repository root, run `npm ci && npm run build`. Then:

```sh
cd examples/agent-session
node ../../dist/cli.js session
```

In another terminal in this directory, run `claude` after reviewing/enabling
`.claude/settings.json`. Ask it to change pricing.ts while preserving PRICE.
Only pricing.ts is editable during this supervised exercise.

To demonstrate drift manually, change Math.max to Math.min in pricing.ts. The
negative input produces a failing contract; the gate blocks progression and
completion. Restore Math.max and fresh evidence becomes healthy.

```sh
node ../../dist/cli.js gate
```

The repository's `npm run demo` automates the same repair cycle in a temporary
project without changing this example or making an LLM request.

When consuming an installed tarball, copy this example outside node_modules
into your project and replace the hook command with your installed `melampus`
executable (or an absolute path to its CLI). Node does not strip TypeScript in
node_modules. Review the claims and inputs before using them on real work.
