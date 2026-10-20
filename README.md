# claude-rename

Auto-name your Claude Code sessions with descriptive, AI-powered titles.

Fork of [sathwick-p/claude-rename](https://github.com/sathwick-p/claude-rename) with a hardened `claude -p` worker, self-healing session markers, and a version-stamped installer.

**Before:** `claude --resume` shows `"i need to write some sort of..."` truncated gibberish.

**After:** `claude --resume` shows `"fix-stripe-webhook-retry"`, `"k8s-helm-ingress-setup"`, `"refactor-auth-middleware"`.

**No separate API key needed** — uses your existing Claude Code subscription.

## Install

### One-liner (just the hook)

```bash
curl -sL https://raw.githubusercontent.com/AKett93/claude-session-rename/main/install.sh | bash
```

This downloads the hook file plus its shared prompt helper, then registers the hook in your Claude Code settings. That's it — new sessions auto-name themselves.

### npx (full CLI — no install)

```bash
# Run any command directly from GitHub:
npx github:AKett93/claude-session-rename install
npx github:AKett93/claude-session-rename list
npx github:AKett93/claude-session-rename backfill
npx github:AKett93/claude-session-rename status
```

### From source

```bash
git clone https://github.com/AKett93/claude-session-rename.git
cd claude-session-rename
npm link           # makes `claude-rename` available globally
claude-rename install
```

## How it works

1. A **Stop hook** fires after each Claude Code assistant turn
2. On the **first meaningful exchange** of a new session, it spawns a **background worker**
3. The worker runs `claude -p` (no tools, no settings, no session persistence) to generate a concise 3-6 word title (max 50 chars)
4. The title is written to the session file — appears in `claude --resume`
5. **Completely silent** — the hook never shows any output to the user
6. **Idempotent** — only names each session once, subsequent turns are a no-op
7. **Self-healing** — if a worker dies, the session is retried after 5 minutes rather than left untitled

### Session chains

When a long task is handed over from one session to the next through a checkpoint file, start the new session with a resume prompt:

```text
Resume [infra-migration #3] from /home/me/notes/infra-migration-checkpoint.md
```

The session is titled `infra-migration #3 · <topic>`, where the topic describes the checkpoint's objective. The tag is optional: `Resume from /path/infra-migration-checkpoint.md` takes the chain name from the file name (without `-checkpoint`), and the part number continues from the last one recorded in `~/.claude/.session-namer-chains.json`. The checkpoint path must not contain spaces.

## Commands

| Command | Description |
|---|---|
| `claude-rename install` | Install the auto-naming Stop hook |
| `claude-rename uninstall` | Remove the hook cleanly |
| `claude-rename list [--project <filter>]` | List all sessions with their titles |
| `claude-rename backfill [--dry-run] [--model <model>]` | Bulk-name all untitled sessions |
| `claude-rename rename <id> <title>` | Manually rename a specific session by exact session ID |
| `claude-rename status` | Show hook installation status |

## Model selection

Backfill uses AI to generate every title. Choose your model:

```bash
claude-rename backfill                    # default: haiku (fast, cheap)
claude-rename backfill --model sonnet     # balanced quality
claude-rename backfill --model opus       # highest quality
```

The hook's background fallback also uses AI. Set a default model in `~/.claude-rename.json`:

```json
{"model": "haiku"}
```

## Architecture

```
You ask Claude something
        |
Claude responds (Stop event fires)
        |
   Hook checks:
        |-- Already named? -> skip (O(1) marker file check)
        |-- Context limit / abort stop? -> skip (never block)
        |-- No real conversation yet? -> skip
        |
   Spawn background worker (claude -p --model haiku)
        |
   Worker generates title -> writes to JSONL -> marks done
        |
   All future Stops -> skip instantly via marker file
```

**Completely silent.** The hook always returns `suppressOutput: true` and never injects anything into your conversation. Title generation happens in a background process.

## Backfilling existing sessions

```bash
# Preview what would be named (no changes)
claude-rename backfill --dry-run

# Name all untitled sessions (default: haiku)
claude-rename backfill

# Use a different model
claude-rename backfill --model sonnet

# Filter to a specific project
claude-rename backfill --project my-project
```

## Session storage

Claude Code stores sessions at `~/.claude/projects/<encoded-path>/<uuid>.jsonl`. The hook uses the `transcript_path` Claude Code passes it and never tries to reproduce that encoding. Titles are written as:

```json
{"type":"custom-title","customTitle":"fix-stripe-webhook-retry","sessionId":"abc-123-..."}
```

This is the same format Claude Code's built-in `/rename` command uses.

## Files

| Path | Purpose |
|---|---|
| `~/.claude/hooks/claude-rename-runner.sh` | Shell wrapper that finds node (NVM/fnm/volta/system) |
| `~/.claude/hooks/claude-rename.mjs` | The Stop hook (copied during install) |
| `~/.claude/hooks/title-prompt.mjs` | Shared title prompt and normalization helper |
| `~/.claude/settings.json` | Hook registration (modified during install) |
| `~/.claude-rename.log` | Debug log (append-only) |
| `~/.claude-rename.json` | Config (optional — set default model) |
| `~/.claude/.session-namer-named/` | Marker files for idempotency (orphans pruned by `status`) |
| `~/.claude/.session-namer-chains.json` | Part numbers for session chains (chain → session ID → part) |

## Uninstalling

```bash
claude-rename uninstall
# or if installed via npm link:
npm unlink -g claude-rename
```

Existing session titles are preserved.

## Requirements

- Node.js >= 18
- Claude Code CLI installed and authenticated

## License

MIT
