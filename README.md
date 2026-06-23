# telltrace

> Instantly understand what Claude Code or Codex just built — flowcharts, file-touch timelines, and visual session replays.

When an agent works for 20 minutes and touches 40 files, you want to know *what it actually did* before reading the diff. **telltrace** turns a session transcript into a single self-contained HTML page: a flowchart of every prompt → tool-call branch, a swimlane timeline of every file touch, and an expandable per-prompt breakdown.

No backend. No login. One HTML file you can drop into Slack.

## Install

```bash
npm install -g telltrace
```

Or run without installing:

```bash
npx telltrace ~/.claude/projects/<your-project>/session.jsonl
```

## Usage

```bash
# Render a session JSONL to ./trace.html
telltrace session.jsonl

# Render the most recent Claude Code session and open it
telltrace --latest --open

# Point at a project directory and pick the newest session
telltrace ~/.claude/projects/-Users-you-repo

# Custom output path
telltrace session.jsonl -o ~/Desktop/replay.html --open
```

## What you get

- **Flow** — a Mermaid flowchart with one branch per prompt, color-coded by tool (read / edit / write / bash / agent / search / web).
- **File touches** — a swimlane timeline showing every read/edit/write/bash hit per file across the session.
- **Session** — each prompt expanded with the tool calls it triggered and the args, ready to inspect.

## Status

Early. v0.1 supports Claude Code JSONL sessions. Codex adapter in progress.

## Roadmap

- [ ] Codex log adapter
- [ ] Subagent expansion (nested Agent tool calls)
- [ ] Inline diff preview per file
- [ ] VS Code extension
- [ ] Web viewer with shareable links

## License

MIT
