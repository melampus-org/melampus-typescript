# SDK registration pilot

Compare three integrations of the same reviewed price contract:

| Style            | Business code  | Registration                           | Evidence path                |
| ---------------- | -------------- | -------------------------------------- | ---------------------------- |
| Existing wrapper | `wrapper.ts`   | At the function definition             | `pilot:wrappedPrice`         |
| Class instance   | `service.ts`   | Once per instance in `registration.ts` | `pilot:PricingService.price` |
| Module object    | `functions.ts` | Once per object in `registration.ts`   | `pilot:price`                |

From the repository root:

```sh
npm ci
npm run demo:registration
```

The demo copies this example to a temporary project and verifies healthy → drift
→ blocked completion → repair for each style. It also removes a scenario call
and checks that evidence becomes incomplete. It never edits this example.

To explore manually after building:

```sh
cd examples/sdk-registration
node ../../dist/cli.js session
# In another terminal, in the same directory:
node ../../dist/cli.js gate
```

Change `Math.max` to `Math.min` in any implementation, query the gate, then repair
it. The supervisor requires all three declared paths to be exercised. Both class
instances contribute evidence to the same class method path; a pass from one
does not cancel a failure from the other. It does not require every instance to
be exercised independently. `label()` is unconfigured and is not verified.

Calls to imported `price()` directly bypass the module object's wrapper. Use
`pricing.price()` for coverage. See [API boundaries](../../docs/SDK-REGISTRATION.md).

## Pilot feedback worksheet

Have participants try all three styles on the same small service, rotating the
order between participants. Use their normal editor and runtime. Record:

| Measure                                             | Wrapper | Class | Module |
| --------------------------------------------------- | ------- | ----- | ------ |
| Minutes from starting setup to first passing gate   |         |       |        |
| Business-code lines changed for integration         |         |       |        |
| Minutes to add a second checked method              |         |       |        |
| Correctly identified covered and uncovered calls?   |         |       |        |
| Understood and repaired a deliberate failing check? |         |       |        |
| Setup or error-message confusion                    |         |       |        |
| Preferred style and reason                          |         |       |        |

These are measurements to collect, not claimed results. Automated success does
not establish user preference or production performance. Pay particular attention
to whether users expect `label()`, pre-registration references, or every function
in a file to be covered.
