# Security

The primary workflow runs reviewed local scenarios alongside a coding agent.
Scenarios and generated implementations run with the user's permissions; the
fresh process is not a sandbox. Use deterministic local inputs and avoid
production credentials or destructive side effects. The supervisor bounds each
run and terminates its process group, but cannot control deliberately detached
children or external side effects.

The local session gate uses a per-session token and loopback binding. Its state
file is owner-readable/writable. This protects against accidental cross-session
requests, not a hostile process running as the same user. Hook enforcement
requires enabled synchronous hooks and a cooperative agent; it is not an OS
security boundary. Missing/stale evidence blocks normal progression.

The optional OTLP path supports local/CI observation and trusted-network collector forwarding.
The watcher has no authentication or TLS and is not a durable tracing backend.
Keep its default loopback bind; secure any remote deployment outside this process.

Requests and decompressed payloads are capped at 1 MiB; session deduplication is
capped at 100,000 spans by default. These bounds do not make the Node HTTP server
suitable for hostile public traffic. Exceeding capacity makes the session incomplete.

Checks execute ordinary JavaScript in the application process. They must be trusted,
pure, fast, synchronous code. A check can mutate an object or block indefinitely;
Melampus cannot prevent that. The execution budget limits count, not runtime.

Hashes are not anonymization. Function paths, check IDs and generator labels are
visible. Avoid sensitive identifiers. SDK checks never capture application values
or exception text, but other OTel instrumentation may do so.

For a suspected vulnerability, use GitHub's private vulnerability reporting if
enabled for this repository. Otherwise contact the maintainers privately through
their GitHub profiles before sharing details; do not put exploit details or secrets
in a public issue. Only the latest alpha is maintained until a stable policy exists.
