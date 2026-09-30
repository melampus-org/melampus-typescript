import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const run = (command, args) =>
  execFileSync(command, args, { encoding: "utf8" }).trim();
if (process.env.GITHUB_REF !== "refs/heads/main" || !process.env.GITHUB_SHA)
  throw new Error("Release must run from main in GitHub Actions");
run(process.execPath, ["scripts/check-version.mjs"]);
const version = readFileSync("VERSION", "utf8").trim(),
  tag = "v" + version;
const tags = run("git", ["tag", "--list", tag]);
if (tags) {
  if (run("git", ["rev-list", "-n", "1", tag]) !== process.env.GITHUB_SHA)
    throw new Error("Existing tag points to a different commit");
  const releases = JSON.parse(
    run("gh", ["release", "list", "--limit", "100", "--json", "tagName"]),
  );
  if (releases.some((r) => r.tagName === tag)) {
    console.log(`${tag} already released`);
    process.exit(0);
  }
} else {
  run(process.execPath, ["scripts/check-version.mjs", "--strict"]);
  run("git", ["config", "user.name", "github-actions[bot]"]);
  run("git", [
    "config",
    "user.email",
    "41898282+github-actions[bot]@users.noreply.github.com",
  ]);
  run("git", ["tag", "-a", tag, "-m", tag]);
  run("git", ["push", "origin", tag]);
}
const notes = readFileSync("CHANGELOG.md", "utf8")
  .split(`## [${version}]`)[1]
  .split("\n## [")[0]
  .replace(/^[^\n]*\n/, "");
writeFileSync("dist/release-notes.md", notes);
const artifacts = readdirSync("dist")
  .filter((f) => f.endsWith(".tgz"))
  .map((f) => "dist/" + f);
if (artifacts.length !== 1)
  throw new Error("Expected exactly one validated package");
run("gh", [
  "release",
  "create",
  tag,
  "--verify-tag",
  "--prerelease",
  "--title",
  `${tag} (alpha)`,
  "--notes-file",
  "dist/release-notes.md",
  ...artifacts,
]);
