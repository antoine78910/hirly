#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const PYTHON_EXCEPTION_RE = /^\s*#\s*stack-policy:\s*python-exception=(.{12,})\s*$/im;

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function addedStagedFiles() {
  return git("diff", "--cached", "--name-only", "--diff-filter=A")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
}

function isProductionPython(file) {
  return file.startsWith("backend/") && file.endsWith(".py") && !file.startsWith("backend/tests/");
}

function stagedContent(file) {
  return git("show", `:${file}`);
}

const violations = [];

for (const file of addedStagedFiles().filter(isProductionPython)) {
  const firstLines = stagedContent(file).split("\n").slice(0, 10).join("\n");
  if (!PYTHON_EXCEPTION_RE.test(firstLines)) violations.push(file);
}

if (violations.length === 0) {
  console.log("stack-policy: ok");
  process.exit(0);
}

console.error("stack-policy: new production Python modules require an explicit exception:");
for (const file of violations) console.error(`  - ${file}`);
console.error("");
console.error("Prefer TypeScript for new isolated backend capabilities.");
console.error("If Python is the fastest safe path, add this within the first 10 lines:");
console.error("  # stack-policy: python-exception=<why TypeScript would be slower or less safe>");
process.exit(1);
