import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { Check, instrumented } from "../dist/index.js";
const directory = process.argv[2];
mkdirSync(directory, { recursive: true });
let count = 0;
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  writeFileSync(join(directory, `${++count}.protobuf`), Buffer.concat(chunks));
  res.writeHead(200, { "Content-Type": "application/x-protobuf" }).end();
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const provider = new NodeTracerProvider({
  spanProcessors: [
    new SimpleSpanProcessor(
      new OTLPTraceExporter({
        url: `http://127.0.0.1:${server.address().port}/v1/traces`,
      }),
    ),
  ],
});
try {
  const fn = instrumented({
    path: "interop:price",
    intent: "Nonnegative",
    checks: [new Check("nonnegative", (value) => value >= 0, "Nonnegative")],
    tracer: provider.getTracer("interop"),
  })((value) => value);
  fn(1);
  fn(-1);
  await provider.forceFlush();
  if (count !== 2) throw new Error("Expected two exported requests");
} finally {
  await provider.shutdown();
  server.closeAllConnections();
  server.close();
}
