#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { watch } from "./watcher.js";
import { serve, gate, type HookEvent } from "./session.js";

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
      config: { type: "string", default: "melampus.json" },
      state: { type: "string", default: ".melampus/session.json" },
      interval: { type: "string", default: "0.5" },
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: "4318" },
      duration: { type: "string", default: "0" },
      "max-spans": { type: "string", default: "100000" },
    },
  });
  if (values.version) {
    console.log(
      JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      ).version,
    );
    return 0;
  }
  if (values.help || !positionals.length) {
    console.log(
      "Usage: melampus <session|gate|hook|watch> [options]\n  session --config melampus.json --state .melampus/session.json --interval 0.5\n  gate    --state .melampus/session.json\n  hook    --state .melampus/session.json  (Claude Code JSON on stdin)\n  watch   --host 127.0.0.1 --port 4318 --duration 30 --max-spans 100000",
    );
    return 0;
  }
  if (positionals.length !== 1) throw new Error("Unexpected arguments");
  const command = positionals[0];
  if (command === "session")
    return serve(values.config, values.state, Number(values.interval));
  if (command === "watch") {
    const port = Number(values.port),
      duration = Number(values.duration),
      maxSpans = Number(values["max-spans"]);
    if (
      !Number.isInteger(port) ||
      port < 0 ||
      port > 65535 ||
      !Number.isFinite(duration) ||
      duration < 0
    )
      throw new Error("Invalid watch options");
    return watch({ host: values.host, port, duration, maxSpans });
  }
  if (command === "gate" || command === "hook") {
    let event: HookEvent = {};
    if (command === "hook") {
      try {
        const input = readFileSync(0, "utf8");
        if (input.length > 16_384) throw new Error("Oversized input");
        event = JSON.parse(input);
        if (!event || typeof event !== "object" || Array.isArray(event))
          throw new Error("Invalid event");
      } catch {
        console.error("Melampus: invalid hook input; no healthy evidence.");
        return 2;
      }
    }
    const result = await gate(values.state, event);
    console.log(
      JSON.stringify(command === "hook" ? result.decision : result.report),
    );
    return command === "hook" ? 0 : result.report.exit_code;
  }
  throw new Error("Unknown command");
}
try {
  process.exitCode = await main();
} catch {
  console.error(
    "Melampus: invalid configuration or unavailable resource. See --help.",
  );
  process.exitCode = 2;
}
