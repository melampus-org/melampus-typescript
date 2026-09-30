# TypeScript 0.1.0 port contract

Reference: [melampus-python at 9518b44](https://github.com/melampus-org/melampus-python/tree/9518b44dfb580305832f6499ff5fead98a6c1ee6),
including the local agent-session workflow introduced by ADR-0008.

| Area                 | TypeScript decision                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| Runtime              | Node 22.18+ ESM; Linux/macOS local supervision                                                       |
| Function declaration | Explicit stable module:function path; typed wrapper instead of decorator                             |
| Check                | Frozen object; synchronous boolean predicate over fulfilled result                                   |
| Async                | Promises/thenables settle before checks; return Promise identity is not preserved                    |
| Wire                 | Identical schema 0.1.0 attributes, ordered arrays, hashes, results and 16-check bound                |
| Sampling             | SHA-256 first 64 bits, same threshold and seed as Python                                             |
| Policy               | Fixed-second count budget per Node isolate, not shared across workers                                |
| Session config       | melampus.json; explicit contracts/probe paths; .ts/.mts/.mjs scenario files                          |
| Freshness            | Content hashes before/after each disposable process; no reuse across changed revisions               |
| Scope                | All session scope symlinks rejected; dist/node_modules/cache folders excluded from recursive watches |
| Ownership            | Atomic lock directory; conservative manual cleanup after abnormal termination                        |
| HTTP                 | Adds bounded chunked transport for standard JavaScript OTel exporter compatibility                   |
| Packaging            | npm ESM package, declarations, CLI, examples, Apache-2.0 license                                     |

Node executes scenario TypeScript with native type stripping, not type checking.
Use erasable syntax, explicit file extensions and a separate tsc check. Native
stripping does not support tsconfig path aliases, decorators, enums or TypeScript
inside node_modules. Copy the packaged example into a project before running it.
See [Node TypeScript support](https://nodejs.org/api/typescript.html).

Golden .protobuf fixtures were serialized by the Python OTel protobuf package.
JSON fixtures and semantic-convention YAML originate in the pinned reference.
CI also sends actual JavaScript exporter bytes through the pinned Python decoder.
Schema attributes are private experimental conventions, not official OTel semconv.
The protobuf projection follows [opentelemetry-proto](https://github.com/open-telemetry/opentelemetry-proto).

Bounds match the Python product: 256 required session checks, 10,000 spans per
scenario, 32 drift examples, maximum ten-second scenario timeout, 1 MiB OTLP body
and decompressed body, default 100,000 watcher span identities, 128 KiB report.
The supervisor kills the process group on success, failure and timeout. Deliberately
detached descendants and external side effects remain outside its control.

Browser builds, CommonJS, decorator APIs, Windows sessions, automatic TypeScript
compilation, LLM launch/repair orchestration and production performance claims
are deferred. The Python media walkthrough is not represented as TypeScript evidence.
