# Measured SDK pilot study

This local terminal study covers every measure in the registration pilot worksheet.
Participants edit real TypeScript with their usual editor. Fresh Melampus gates
verify task completion. Answers and preference are supplied by the participant.
The harness and SDK registration API are unreleased prototypes.

## Try the whole workflow automatically

From the checkout root:

```sh
npm ci
npm run demo:pilot
```

The synthetic walkthrough starts with missing instrumentation, registers the first
method, adds a second, submits scripted coverage answers, observes a deliberately
failing predicate and blocked completion, repairs it, and supplies scripted notes
and preference. It exercises all three styles and writes reports under
`pilot-results/demo-<timestamp>/`. Those timings and answers are automated data;
they are prominently labeled synthetic and cannot establish human usability.

## Run with a pilot participant

```sh
npm run pilot -- --participant p01 --rotation 0
```

The command builds before the study starts. Node 22.18+ and dependency installation
are shared prerequisites, outside the integration task timers. Each task starts
when its instructions appear and includes reading, edits, and gate evaluation.
The study measures SDK integration into a prepared service, not machine setup.

Open the printed style directory in the participant's usual editor. Keep the
terminal available. Follow its prompts, edit `business.ts` or `entry.ts`, and enter
`check` for a fresh gate. Retain the supplied formulas during integration. The
runner deliberately changes a formula later for the repair task.

Type `pause` at any prompt, or use Ctrl+C, to save progress and stop counting time.
Repeat the same command, including participant, rotation, and any `--dir`, to
resume. Checkpoints run once per second. An unexpected termination resumes from
the last saved elapsed time, excluding downtime and recording an interruption;
up to one second may be lost. A crash can leave a `.lock` beside the study directory;
verify the earlier runner stopped before removing that stale lock.

```sh
# Optional persistent output location:
npm run pilot -- --participant p01 --rotation 0 --dir /path/to/p01-study
```

Use pseudonymous participant IDs. Results remain local. The harness refuses to
overwrite an unrelated directory. `pilot-results/` is ignored by Git. Export or
share reports separately after reviewing the participant's free-text responses.
Run one terminal study process per directory. Once complete, use a new ID/directory
for another trial; a completed study is preserved.

## Tasks and exact worksheet mapping

| Worksheet measure                                  | Demo task                                                                                                                                       | Recorded evidence                                                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Minutes from starting setup to first passing gate  | Instrument `price` and obtain gate 0                                                                                                            | Active milliseconds, minutes, all attempts and exit codes                                                        |
| Business-code lines changed for integration        | Compare first successful `business.ts` with its uninstrumented baseline                                                                         | Added/deleted lines and their sum; initial submitted snapshot                                                    |
| Minutes to add a second checked method             | Register `discount`; both reviewed paths must pass                                                                                              | Separate active timer, gate attempts, and incremental business diff                                              |
| Correctly identified covered/uncovered calls       | Six questions about configured calls, omitted methods, captured references, direct/unregistered calls, missing execution, and drift aggregation | Every answer, ground truth, correctness, and score                                                               |
| Understood and repaired a deliberate failing check | Observe negative-price drift and blocked completion, identify its cause, explain it, then repair                                                | Diagnosis correctness, explanation, failing evidence, block decision, repair attempts, fresh gate 0, repair time |
| Setup or error-message confusion                   | Three explicit questions after each style                                                                                                       | Setup, second-method, and error-message notes; `none` is a valid response                                        |
| Preferred style and reason                         | Final comparison after all styles                                                                                                               | Selected style and participant's free-text reason                                                                |

The business file contains price, discount, and an unconfigured label method.
Only the required contracts and exercised scenarios support a passing gate.
Fresh probes run for each check. The supplied intent, SDK bridge, scenario, config,
and package files are reviewed fixtures: editing them cannot produce a task pass.
The harness extends the reviewed registry itself before the second task. The
scenario calls all three fixture methods throughout; only price should produce
check evidence in the first task. An early discount integration, extra label
checks, or duplicate wrappers fail the task protocol even if the SDK gate is
healthy. Attempts retain the SDK exit code separately from the task outcome.

The business-code metric counts literal line additions and deletions. A replacement
counts as two changed lines. Formatting changes count; CRLF/LF differences do not.
Edits to `entry.ts` are registration setup and excluded from this metric. Consequently,
class/module solutions can score zero business-code edits while still needing
registration changes. This is a defined metric, not a claim about total effort.

## Equal preparation and integration help

All styles have the same nonnegative price and integer-discount claims, inputs
(-100, 0, 250), runtime, and checkpoints. The wrapper round uses existing
`PRICE.instrument({ path: "pilot:price" })(fn)` in `business.ts`. Class/module
rounds use `instrument(target, { namespace, contracts })` in `entry.ts`, importing
`instrument` from the generated `./sdk.ts` bridge and `PRICE`/`DISCOUNT` from
`./intent.ts`. The bridge resolves this built checkout without requiring an npm
publication or installing dependencies separately for each round.

For class registration use `namespace: "pilot:PricingService"`; for module
registration use `namespace: "pilot"`. Each round initially requires only price.
After its first pass, add discount. Do not change the formulas or weaken checks.
Participants may consult [SDK registration documentation](../../docs/SDK-REGISTRATION.md)
and [the existing wrapper example](../sdk-registration/wrapper.ts). Apply the same
help policy to every participant and record any facilitator assistance in notes.

Assign successive participants to rotations 0–5 and repeat:

| Rotation | First   | Second  | Third   |
| -------- | ------- | ------- | ------- |
| 0        | wrapper | class   | module  |
| 1        | wrapper | module  | class   |
| 2        | class   | wrapper | module  |
| 3        | class   | module  | wrapper |
| 4        | module  | wrapper | class   |
| 5        | module  | class   | wrapper |

This balances presentation order across a six-participant block. It does not
eliminate learning effects; retain the order in analysis. Observe without solving
tasks for the participant. The diagnosis multiple-choice score checks basic cause
recognition; read the explanation to assess deeper understanding.

## Reports

Each study writes:

- `feedback.md`: the completed comparison worksheet (pending cells stay empty).
- `feedback.csv`: one row per style, with participant ID, mode, rotation, completion
  status, all worksheet measures, notes, and preference. Filter to completed
  `participant` studies when analyzing usability; exclude `synthetic` rows.
- `study.json`: full state, active timing, attempt histories, snapshots, answers,
  explanations, interruption count, and preference. This enables resume and audit.

Preference is never inferred from speed or code edits. Participants can select
`no-preference` rather than being forced to choose a style. A wrong diagnosis or quiz
answer remains wrong even if the participant later repairs the code. Incomplete
studies remain incomplete. Human preference, comfort, and performance conclusions
require actual participants; the automated demo validates collection and gates.
