/**
 * Shared title-generation prompt, normalization, and CLI invocation.
 * Keep the hook fallback and the CLI backfill logic aligned.
 */

import { spawn } from "child_process";
import { appendFileSync } from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";

const LOG_FILE = join(homedir(), ".claude-rename.log");

// Flags passed to every `claude -p` worker call:
//   --no-session-persistence  worker never writes a session file, so it
//                             cannot appear in `claude --resume`
//   --tools ""                no tools: a titling prompt must never run
//                             Bash, read files, or trigger hooks
//   --setting-sources ""      ignore the user's settings, hooks, MCP servers
//                             and CLAUDE.md so the worker is fast and isolated
export const WORKER_CLI_FLAGS = [
  "--no-session-persistence",
  "--tools",
  "",
  "--setting-sources",
  "",
];

// Run from the OS temp dir so a stray cwd-relative read hits nothing useful.
const WORKER_CWD = tmpdir();

const TITLE_PROMPT_RULES = `Rules:
- 3-6 words, kebab-case, lowercase, max 50 characters
- Be SPECIFIC: mention the actual technology, feature, file, or bug
- Focus on WHAT was done, not how the conversation started
- Never include URLs, file paths, or generic words like "help", "work", "session", "project"
- Good: "fix-stripe-webhook-retry", "k8s-helm-ingress-setup", "refactor-auth-middleware"
- Bad: "coding-session", "helping-with-code", "read-and-understand-repo"`;

export function buildTitlePrompt(userMessages, assistantMessages, options = {}) {
  const {
    replyInstruction = "Reply with ONLY the title, nothing else",
    includeQuotesNote = false,
  } = options;

  const userContext = userMessages.slice(0, 3).join("\n\n").slice(0, 1500);
  const assistantContext = assistantMessages
    .slice(0, 1)
    .join("\n")
    .slice(0, 500);

  const replyLine = includeQuotesNote
    ? `${replyInstruction} — no explanation, no quotes`
    : replyInstruction;

  return `You generate short session titles for Claude Code conversations.

${TITLE_PROMPT_RULES}
- ${replyLine}

User messages:
${userContext}

Assistant response:
${assistantContext}

Title:`;
}

export function normalizeGeneratedTitle(rawOutput) {
  if (typeof rawOutput !== "string") return null;

  let title = rawOutput.trim();
  const lines = title.split("\n").filter((line) => line.trim());
  if (lines.length > 0) {
    title = lines[lines.length - 1].trim();
  }

  title = title
    .replace(/[`'"'"'"*]/g, "")
    .replace(/^[^a-z0-9]*/i, "")
    .replace(/[.\s]+$/, "")
    .replace(/\s+/g, "-")
    .toLowerCase();

  if (title && title.length >= 5 && title.length <= 50 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(title)) {
    return title;
  }

  return null;
}

/**
 * Run `claude -p --model <model>` with the given prompt piped via stdin.
 * The worker runs with no tools, no settings and no session persistence,
 * so it is isolated from the user's environment and leaves nothing behind.
 *
 * @param {string} prompt - The prompt to send
 * @param {string} model - Model name (e.g. "haiku", "sonnet")
 * @param {number} [timeoutMs=30000]
 * @returns {Promise<string|null>} Normalized kebab-case title, or null
 */
export function generateTitleViaCLI(prompt, model, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const child = spawn("claude", ["-p", "--model", model, ...WORKER_CLI_FLAGS], {
      cwd: WORKER_CWD,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      child.kill();
      log(`claude -p timed out after ${timeoutMs}ms (model=${model})`);
      finish(null);
    }, timeoutMs);

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      const title = normalizeGeneratedTitle(stdout);
      if (!title) {
        log(
          `Title rejected (exit=${code}, model=${model}) stdout=${JSON.stringify(stdout.slice(0, 200))} stderr=${JSON.stringify(stderr.slice(0, 200))}`,
        );
      }
      finish(title);
    });

    child.on("error", (err) => {
      log(`claude -p failed to start: ${err.message}`);
      finish(null);
    });

    child.stdin.on("error", () => {});
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function log(msg) {
  try {
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
}
