#!/usr/bin/env node

import process from "node:process";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

let input = {};
try {
  input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
} catch {
  process.exit(0);
}

const event = String(input.hook_event_name || input.hookEventName || "");
const prompt = String(input.prompt || input.user_prompt || "");
const toolName = String(input.tool_name || "");
const toolInput = input.tool_input && typeof input.tool_input === "object"
  ? input.tool_input
  : {};
const filePath = String(
  toolInput.file_path
  || toolInput.path
  || toolInput.filename
  || "",
);

const relevantPrompt = /\b(add|build|create|implement|feature|refactor|rewrite|migrat|port|scraper|scrapper|crawler|provider|ingest|inventory|backend|python|typescript)\b/i.test(prompt);

let additionalContext = "";

if (event === "UserPromptSubmit" && relevantPrompt) {
  additionalContext = [
    "[HIRLY STACK POLICY]",
    "Before implementation classify this change as PY_FIX, TS_NEW, TS_MIGRATION, or PY_EXCEPTION.",
    "Fix existing Python behavior in place when fastest; build isolated new backend capabilities and new scrapers in TypeScript; migrate bounded Python capabilities when substantial work reaches them without delaying retention or fulfillment.",
    "A capability must have one canonical writer. Read AGENTS.md and docs/engineering/stack-migration-policy.md.",
  ].join("\n");
}

const isPythonProductionEdit = (
  event === "PostToolUse"
  && /^(Write|Edit|MultiEdit)$/.test(toolName)
  && /(^|\/)backend\/.*\.py$/.test(filePath)
  && !/(^|\/)backend\/tests\//.test(filePath)
);

if (isPythonProductionEdit) {
  additionalContext = [
    "[HIRLY STACK POLICY — PYTHON EDIT]",
    "Confirm this edit is a PY_FIX or an approved PY_EXCEPTION, not an isolated new capability that belongs in TypeScript.",
    "New production Python files require `# stack-policy: python-exception=<specific reason>` in the first 10 lines.",
    "Continue automatically when the classification is satisfied; do not ask for confirmation.",
  ].join("\n");
}

if (!additionalContext) process.exit(0);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: event || "UserPromptSubmit",
    additionalContext,
  },
}));
