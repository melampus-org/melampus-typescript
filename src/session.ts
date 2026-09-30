import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readBody } from "./watcher.js";

const IGNORED = new Set([
  ".git",
  "node_modules",
  ".melampus",
  "coverage",
  "dist",
]);
const READ_TOOLS = new Set(["Read", "Glob", "Grep", "AskUserQuestion"]);
export interface Report {
  exit_code: number;
  state?: string;
  [key: string]: unknown;
}
export interface HookEvent {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: { file_path?: string };
  cwd?: string;
}
const digest = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep);
}
export class Supervisor {
  readonly config: string;
  readonly root: string;
  readonly contracts: string;
  readonly probe: string;
  readonly watch: string[];
  readonly protected: Set<string>;
  readonly baseline: Map<string, string>;
  readonly timeout: number;
  revision = "";
  generation = 0;
  report: Report = {
    exit_code: 2,
    state: "incomplete",
    message: "Not evaluated.",
  };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(config: string) {
    this.config = realpathSync(config);
    this.root = dirname(this.config);
    const data = JSON.parse(readFileSync(this.config, "utf8"));
    this.contracts = this.local(data.contracts);
    this.probe = this.local(data.probe);
    const paths = (input: unknown) => {
      if (!Array.isArray(input)) throw new Error("Paths must be arrays");
      return input.map((p) => this.local(p));
    };
    this.watch = paths(data.watch);
    if (!this.watch.length) throw new Error("Watch paths required");
    this.protected = new Set([
      this.config,
      this.contracts,
      this.probe,
      ...paths(data.protect ?? []),
    ]);
    this.baseline = new Map([...this.protected].map((p) => [p, digest(p)]));
    this.timeout = data.timeout ?? 5;
    if (
      typeof this.timeout !== "number" ||
      !Number.isFinite(this.timeout) ||
      this.timeout <= 0 ||
      this.timeout > 10
    )
      throw new Error("Timeout must be in (0,10] seconds");
  }
  local(name: unknown): string {
    if (typeof name !== "string" || !name)
      throw new Error("Paths must be nonempty strings");
    const path = resolve(this.root, name);
    if (!inside(this.root, path)) throw new Error("Path escapes project");
    // Check every existing component, including ancestors of not-yet-created files.
    let component = this.root;
    for (const part of relative(this.root, path).split(sep).filter(Boolean)) {
      component = join(component, part);
      try {
        if (lstatSync(component).isSymbolicLink())
          throw new Error("Symlinks are unsupported in session scope");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return path;
  }
  snapshot(): string {
    const files = new Set(this.protected);
    const visit = (path: string) => {
      this.local(path);
      if (existsSync(path) && statSync(path).isDirectory()) {
        for (const entry of readdirSync(path))
          if (!IGNORED.has(entry)) visit(join(path, entry));
      } else files.add(path);
    };
    this.watch.forEach(visit);
    const entries = [...files].sort().map((p) => {
      this.local(p);
      return [relative(this.root, p), existsSync(p) ? digest(p) : "missing"];
    });
    return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  }
  repairPath(name: unknown): boolean {
    const path = this.local(name);
    return (
      !this.protected.has(path) &&
      !relative(this.root, path)
        .split(sep)
        .some((p) => IGNORED.has(p)) &&
      this.watch.some(
        (source) =>
          path === source ||
          (existsSync(source) &&
            statSync(source).isDirectory() &&
            inside(source, path)),
      )
    );
  }
  async runProbe(): Promise<Report> {
    const directory = mkdtempSync(join(tmpdir(), "melampus-probe-"));
    const input = join(directory, "input.json");
    const output = join(directory, "report.json");
    writeFileSync(
      input,
      JSON.stringify({ contracts: this.contracts, probe: this.probe }),
    );
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("./probe.js", import.meta.url)), input, output],
      { cwd: this.root, detached: true, stdio: "ignore" },
    );
    let timedOut = false;
    const kill = () => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* Group already exited. */
        }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, this.timeout * 1000);
    try {
      const code = await new Promise<number | null>((done, reject) => {
        child.once("error", reject);
        child.once("exit", done);
      });
      if (timedOut) return { exit_code: 2, message: "Scenario timed out." };
      if (code !== 0 || !existsSync(output) || statSync(output).size > 128_000)
        return {
          exit_code: 2,
          message: "Scenario exited without valid evidence.",
        };
      const report = JSON.parse(readFileSync(output, "utf8"));
      if (![0, 1, 2].includes(report.exit_code))
        throw new Error("Invalid probe report");
      return report;
    } finally {
      clearTimeout(timer);
      kill();
      rmSync(directory, { recursive: true, force: true });
    }
  }
  check(): Promise<Report> {
    const next = this.queue.then(() => this.checkRevision());
    this.queue = next.catch(() => {});
    return next;
  }
  private async checkRevision(): Promise<Report> {
    try {
      const revision = this.snapshot();
      if (revision === this.revision) return this.report;
      this.generation++;
      const changed = [...this.baseline]
        .filter(([p, hash]) => !existsSync(p) || digest(p) !== hash)
        .map(([p]) => relative(this.root, p));
      let report: Report = changed.length
        ? {
            exit_code: 2,
            protected_changed: changed.sort(),
            message:
              "Reviewed files changed. Restore them or obtain review and restart.",
          }
        : await this.runProbe();
      if (this.snapshot() !== revision) {
        report = {
          exit_code: 2,
          message: "Source changed during evaluation; fresh evidence required.",
        };
        this.revision = "";
      } else this.revision = revision;
      this.report = {
        ...report,
        revision,
        generation: this.generation,
        state: ["healthy", "drift", "incomplete"][report.exit_code]!,
      };
    } catch {
      this.revision = "";
      this.report = {
        exit_code: 2,
        state: "incomplete",
        message: "Unable to evaluate current source/configuration.",
      };
    }
    return this.report;
  }
}

export function hookDecision(
  event: HookEvent,
  report: Report,
  supervisor?: Supervisor,
): Record<string, unknown> {
  const name = event.hook_event_name;
  const broken = report.exit_code !== 0;
  const reason =
    "Melampus: " +
    JSON.stringify(report) +
    "\nRepair the implementation using Edit/Write, then obtain fresh healthy evidence. Do not weaken contracts. Ask the owner if intent must change.";
  if (name === "PreToolUse") {
    const tool = event.tool_name ?? "unknown";
    if (READ_TOOLS.has(tool)) return {};
    let canEdit = false;
    if (supervisor && ["Edit", "Write"].includes(tool)) {
      try {
        canEdit = supervisor.repairPath(event.tool_input?.file_path);
      } catch {
        /* Deny out-of-scope repair. */
      }
    }
    if ((broken && !canEdit) || (["Edit", "Write"].includes(tool) && !canEdit))
      return {
        hookSpecificOutput: {
          hookEventName: name,
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      };
    if (broken)
      return {
        hookSpecificOutput: { hookEventName: name, additionalContext: reason },
      };
  } else if (broken && (name === "Stop" || name === "PostToolUse"))
    return { decision: "block", reason };
  else if (broken && name === "PostToolUseFailure")
    return {
      hookSpecificOutput: { hookEventName: name, additionalContext: reason },
    };
  return {};
}

export async function serve(
  config: string,
  state: string,
  interval = 0.5,
): Promise<number> {
  if (process.platform === "win32")
    throw new Error("Local sessions require macOS or Linux");
  if (!Number.isFinite(interval) || interval <= 0)
    throw new Error("Invalid poll interval");
  const supervisor = new Supervisor(config);
  state = resolve(state);
  mkdirSync(dirname(state), { recursive: true });
  const lock = state + ".lock";
  // Atomic directory ownership. A crash leaves a conservative stale lock; see docs.
  mkdirSync(lock, { mode: 0o700 });
  const token = randomBytes(32).toString("hex");
  const server = createServer(async (req, res) => {
    const supplied = Buffer.from(req.headers.authorization ?? "");
    const expected = Buffer.from("Bearer " + token);
    if (
      req.method !== "POST" ||
      req.url !== "/gate" ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      res.writeHead(403).end();
      return;
    }
    try {
      const event = JSON.parse((await readBody(req, 16_384)).toString());
      if (!event || typeof event !== "object" || Array.isArray(event))
        throw new Error("Invalid event");
      const report = await supervisor.check();
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          report,
          decision: hookDecision(event, report, supervisor),
        }),
      );
    } catch {
      if (!res.destroyed) res.writeHead(400).end();
    }
  });
  server.maxConnections = 16;
  server.requestTimeout = 1000;
  server.headersTimeout = 1000;
  server.setTimeout(25_000, (socket) => socket.destroy());
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  try {
    writeFileSync(
      join(lock, "owner.json"),
      JSON.stringify({ pid: process.pid }),
      { mode: 0o600 },
    );
    await new Promise<void>((done, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", done);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No server address");
    writeFileSync(
      state,
      JSON.stringify({ port: address.port, token, root: supervisor.root }),
      { mode: 0o600 },
    );
    chmodSync(state, 0o600);
    console.log(`READY melampus session; state=${state}`);
    let last = "";
    const poll = async () => {
      const serialized = JSON.stringify(await supervisor.check());
      if (serialized !== last) {
        console.log("SESSION " + serialized);
        last = serialized;
      }
      if (!stopped)
        timer = setTimeout(() => {
          void poll();
        }, interval * 1000);
    };
    void poll();
    await new Promise<void>((done) => {
      const stop = () => {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        done();
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
    return 0;
  } finally {
    stopped = true;
    clearTimeout(timer);
    server.closeAllConnections();
    server.close();
    await supervisor.check();
    rmSync(state, { force: true });
    rmSync(lock, { recursive: true, force: true });
  }
}

export async function gate(
  state: string,
  event: HookEvent = {},
): Promise<{ report: Report; decision: Record<string, unknown> }> {
  try {
    const descriptor = JSON.parse(readFileSync(state, "utf8"));
    if (
      !Number.isInteger(descriptor.port) ||
      descriptor.port < 1 ||
      descriptor.port > 65535 ||
      typeof descriptor.token !== "string" ||
      typeof descriptor.root !== "string"
    )
      throw new Error("Invalid state");
    if (
      event.cwd &&
      !inside(realpathSync(descriptor.root), realpathSync(event.cwd))
    )
      throw new Error("Different project");
    if (
      event.tool_input !== undefined &&
      (!event.tool_input ||
        typeof event.tool_input !== "object" ||
        Array.isArray(event.tool_input))
    )
      throw new Error("Invalid tool input");
    // Never send source content, commands, arguments or application output.
    const minimal = {
      hook_event_name: event.hook_event_name,
      tool_name: event.tool_name,
      tool_input: { file_path: event.tool_input?.file_path },
    };
    const response = await fetch(`http://127.0.0.1:${descriptor.port}/gate`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + descriptor.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(minimal),
      signal: AbortSignal.timeout(25_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("Supervisor rejected request");
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (!response.body) throw new Error("Missing response");
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 128_000) throw new Error("Oversized response");
      chunks.push(chunk);
    }
    const result = JSON.parse(Buffer.concat(chunks).toString());
    if (
      ![0, 1, 2].includes(result.report?.exit_code) ||
      !result.decision ||
      typeof result.decision !== "object"
    )
      throw new Error("Invalid supervisor response");
    return result;
  } catch {
    const report = {
      exit_code: 2,
      state: "incomplete",
      message:
        "Local supervisor unavailable. Start melampus session; do not claim success.",
    };
    return { report, decision: hookDecision(event, report) };
  }
}
