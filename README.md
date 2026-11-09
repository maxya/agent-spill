Find what your coding agent already spilled.

When you click 'Yes, and don't ask again' in Claude Code (or another coding agent), the full approved command — secrets included — gets saved into a settings file. agent-spill scans your own repos for those saved credentials: settings files, shell history, transcripts, and git history, across every agent folder. It runs entirely on your machine, never uploads anything, and never prints a secret — findings show a masked prefix and a length only.

## Install and run

Requires Node.js 22.13 or newer. There are no runtime dependencies.

```sh
npx agent-spill                     # scan the current directory tree + this machine's agent stores
npx agent-spill --root ~/code       # scan a tree of repos (repeatable)
npx agent-spill --json > report.json
```

Useful flags:

```
--root <dir>          search under this directory (repeatable; default: cwd)
--no-home             skip home-directory agent stores and shell history
--no-history          working tree only (no git history)
--ci                  preset: --no-home --fail-on committed; warns on shallow clones
--fail-on <grade>     local | at-risk | committed | pushed (default: at-risk)
--min-confidence <c>  high | medium | low (default: medium)
--json                machine-readable report on stdout (schema 1)
--verbose             expand LOCAL findings and list every location
--max-depth <n>       directory walk depth under each root (default: 8)
```

Exit codes: `0` nothing at or above `--fail-on`, `1` usage or runtime error, `2` findings at or above `--fail-on`.

## What it scans

**In-repo targets** (found under `--root`, in the work tree and in git history):

| Agent | Paths | Format |
|---|---|---|
| Claude Code | `.claude/settings.json`, `.claude/settings.local.json` | json |
| Claude Code | `.mcp.json` | json |
| Cursor | `.cursor/mcp.json`, `.cursor/*.json` | json |
| VS Code / Copilot | `.vscode/mcp.json` | json |
| Gemini CLI | `.gemini/settings.json`, `.gemini/policies/*.toml` | json / text |
| Codex | `.codex/config.toml`, `.codex/rules/*.rules` | text |
| SpecStory | `.specstory/history/**` | text |
| Continue | `.continue/**` | json / text |
| Aider | `.aider.chat.history.md`, `.aider.input.history` | text |

**Home-store targets** (always graded `LOCAL`; `CLAUDE_CONFIG_DIR` and `CODEX_HOME` are honored):

| Agent | Paths |
|---|---|
| Claude Code | `~/.claude/settings.json`, `~/.claude/settings.local.json`, `~/.claude.json` |
| Claude Code | `~/.claude/history.jsonl`, `~/.claude/projects/**/*.jsonl` |
| Codex | `~/.codex/rules/*.rules`, `~/.codex/config.toml` |
| Codex | `~/.codex/history.jsonl`, `~/.codex/sessions/**/*.jsonl` |
| Gemini CLI | `~/.gemini/settings.json`, `~/.gemini/policies/*.toml`, `~/.gemini/tmp/*/chats/**` |
| Shell | `$HISTFILE`, `~/.bash_history`, `~/.zsh_history`, fish history, PowerShell PSReadLine history |

Excluded on purpose: intended credential stores such as `~/.codex/auth.json`, `~/.claude/.credentials.json`, `~/.gemini/oauth_creds.json`, `~/.aws/credentials`, `~/.netrc`, `~/.npmrc`, `~/.docker/config.json`, and any `.env*` file. Flagging the place a secret is supposed to live is noise; other tools cover those.

## Grades

The worst location wins per secret.

| Grade | Meaning |
|---|---|
| `PUSHED` | In a commit reachable from `refs/remotes/*` as of the last fetch. Public or private is not checked. |
| `COMMITTED` | In local history but not on a remote-tracking ref, or tracked in the index. |
| `AT-RISK` | In the work tree, untracked, and not ignored by the repository's own rules. |
| `LOCAL` | Ignored by repository rules, or outside any repo (home stores, shell history). |

`historyOnly` marks a secret that is in history but no longer in a work-tree file. Deleting the file did not un-leak it.

## Detection rules

- **Command-embedded passwords**: `PGPASSWORD=`, `MYSQL_PWD=`, `mysql -p…`, `sshpass -p`, `redis-cli -a`, `--password`, `curl -u user:pass`, `Authorization:` and API-key headers, credentials in URLs.
- **Known token formats**: GitHub, Anthropic, OpenAI, AWS, Stripe, Slack, Slack webhooks, Google, GitLab, npm, Hugging Face, JWTs (Supabase `service_role` is high; `anon` is dropped), private-key blocks.
- **Generic secret-named assignments** (`*_TOKEN=`, `*_SECRET=`, `*_API_KEY=`, …) with a length and entropy floor.

Every captured value goes through a placeholder filter and, for generic rules, an entropy check. JSON and JSONL are parsed and rules run over decoded string values, so `PGPASSWORD=\"x\"` inside a transcript is seen as the command it was.

## Privacy promises

- **No network calls.** Everything is local. There is a test that fails if `src/` imports a network module or calls `fetch()`.
- **No secret is ever printed.** A finding contains only a fixed vendor marker (for example `ghp_` is represented by `gh`), a length, and a per-run fingerprint. The raw value exists only in memory until findings are aggregated.
- **No disk writes.** Fingerprints use a random per-run HMAC key, never persisted. The tests snapshot the temp directory and fixture mtimes around a run.
- **Zero runtime dependencies.** The supply chain is TypeScript and `@types/node`, both dev-only.

## CI

```yaml
# .github/workflows/agent-spill.yml
on: [push, pull_request]
jobs:
  agent-spill:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with: { fetch-depth: 0 }          # history scan needs full clone
      - uses: actions/setup-node@v7
        with: { node-version: 26 }
      - run: npx --yes agent-spill@0 --ci
```

`--ci` scans only the checkout, skips home stores, fails on `COMMITTED` or worse, and warns when the clone is shallow (`actions/checkout` defaults to depth 1).

## Rotate first

Deleting a file does not un-leak a secret. Rotate or revoke the credential at the provider first. Then remove the literal from the agent setting (for Claude settings, replace the literal allow rule with a prefix rule such as `Bash(psql:*)` and pass the password through the environment). If the value was committed or pushed, purge history with `git filter-repo --path <file> --invert-paths` (or BFG) and force-push — but forks, clones and caches keep old copies, so rotation is the real fix.

## What it doesn't do

- It does not scan a repository's entire history for every possible secret. Use gitleaks or TruffleHog for that; agent-spill only examines agent-target paths.
- It does not scan other people's repositories or public code.
- It does not validate whether a key is live or contact any provider.
- It does not use a model for classification.
- Cursor's SQLite allowlist (`state.vscdb`) and Continue's home-level config are deferred pending verification against real installs.

## Background

Apiiro reported on 2026-11-05 that Claude Code's "Yes, and don't ask again" saves the full approved command, secrets included, in plaintext in `.claude/settings.local.json`. Their public GitHub scan found 104,185 copies, 1,122 (1.1%) with at least one secret; counting history, shared settings and transcripts, 2,539 distinct secrets in 1,994 repositories. 734 secrets appeared only in old git history. Treat those as vendor research: Apiiro sells agent-security products, tested no credentials, contacted no host, and its "real secret" classification rests partly on an LLM reviewer with no third-party replication. The gap that matters here is concrete: the rival scanners miss command-embedded passwords, transcripts, and history where the file was deleted.

Compared with `claude-settings-leak-check` (Claude settings only; no history, transcripts or other agents) and `claudleak` (public-repo/org scanning with TruffleHog over full history, inheriting its misses), agent-spill is local-first and targets the command-embedded, transcript, and deleted-file history classes.

Found a real leak? Tell us without pasting any secret value: https://github.com/maxya/agent-spill/issues/new?template=found-a-leak.yml

## Development

```sh
npm install
npm test        # builds src + tests, runs node:test
npm run check   # type-check plus tests
```

MIT licensed.
