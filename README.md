# telltrace

> Your agent session as a thread you can actually read.

![a Claude Code session rendered by telltrace](docs/screenshot.png)

*Try it on the bundled samples: `telltrace samples/demo-session.jsonl --open` (Claude Code) or `telltrace samples/demo-codex-session.jsonl --open` (Codex)*

Claude Code just worked for 40 minutes and touched 30 files. Before you commit — or when a teammate asks "how was this made?" — you need the story, not a 4000-line JSONL file.

**telltrace** renders any Claude Code or Codex session as a familiar, Reddit-style thread (format auto-detected):

- **Your prompts are posts.** Title, body, an ops-count in the karma gutter, file flair.
- **The agent's work is the comment thread.** Claude's narration becomes comments; the tool calls it made under each one are collapsed into compact runs (`Edit ×6 render.js`), threaded and foldable exactly like Reddit comments.
- **Subagent threads.** When the agent spawns subagents (Task/Agent tools), their work nests one level deeper — a real comment tree, with each subagent's own narration, tool calls, and diffs. Token usage and files touched roll up into the session totals.
- **Diffs where they happened.** Every `Edit`/`Write`/`apply_patch` gets a `diff` badge — click it to expand a color-coded diff of exactly what changed, right under the prompt that caused it.
- **The sidebar is "About this session".** Prompts, tool calls, files touched, duration, token usage — plus an activity graph, top files, and tool mix.

One self-contained HTML file. No server, no login, works offline. Drop it in Slack, attach it to a PR, post it.

## Install

```bash
npm install -g telltrace
```

Or zero-install:

```bash
npx telltrace --latest --open
```

## Usage

```bash
# Your most recent agent session (Claude Code or Codex), opened in the browser
telltrace --latest --open

# Latest session from one agent only
telltrace --latest claude --open
telltrace --latest codex --open

# A specific session
telltrace ~/.claude/projects/<project>/<session>.jsonl --open
telltrace ~/.codex/sessions/<yyyy>/<mm>/<dd>/<rollout>.jsonl --open

# Newest session in a project directory
telltrace ~/.claude/projects/<project> --open

# Custom output
telltrace --latest -o replay.html
```

## Why

- **Audit before you commit.** Autonomous runs need receipts.
- **Explain your PR.** Attach the trace; reviewers see every prompt and every file the agent read before it wrote.
- **Share the run.** "The agent built this in one session" hits different with the thread to prove it.

## Privacy & sharing

A trace contains your prompts, Claude's narration, and every shell command from the session — treat it like a chat log.

- **Automatic redaction:** common credential formats (Anthropic/OpenAI-style keys, GitHub tokens, AWS access keys, Slack tokens, JWTs, bearer tokens, private key blocks, `password=`/`api_key=` assignments) are replaced with `[redacted]` at render time.
- **Redaction is best-effort.** Novel token formats or secrets pasted as plain prose can slip through — skim a trace before posting it publicly.
- All session content is HTML-escaped before rendering, so a malicious string inside a session can't execute script in the viewer's browser.
- The only external request the page makes is loading fonts from Google Fonts (no session data leaves the file); everything else works offline.

## Roadmap

- [x] Codex log adapter
- [x] Subagent threads (nested one level deeper, like real comment trees)
- [x] Inline diffs per Edit/Write
- [ ] `telltrace share` — hosted, linkable traces
- [ ] GitHub Action: auto-attach a trace to agent-generated PRs

## License

MIT
