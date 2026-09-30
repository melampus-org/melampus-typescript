import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const version = readFileSync("VERSION", "utf8").trim();
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
  throw new Error("VERSION must be X.Y.Z");
const pkg = JSON.parse(readFileSync("package.json"));
const lock = JSON.parse(readFileSync("package-lock.json"));
if (
  pkg.version !== version ||
  lock.version !== version ||
  lock.packages[""].version !== version
)
  throw new Error("VERSION, package.json and lockfile must agree");
if (!readFileSync("CHANGELOG.md", "utf8").includes(`## [${version}]`))
  throw new Error("Missing changelog entry");
if (process.argv.includes("--strict")) {
  const tags = execFileSync("git", ["tag", "--list", "v*"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  const parts = version.split(".").map(Number);
  for (const tag of tags) {
    const previous = tag.slice(1).split(".").map(Number);
    const differing = parts.findIndex((part, i) => part !== previous[i]);
    if (differing === -1 || parts[differing] < previous[differing])
      throw new Error(`${version} must exceed ${tag}`);
  }
}
console.log(`Version ${version} is consistent`);
