#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { parseSession } from '../src/parser.js';
import { parseCodexSession, looksLikeCodexSession } from '../src/parser-codex.js';
import { renderHTML } from '../src/render.js';

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
  process.stdout.write(`telltrace — visualize what an agent built

Usage:
  telltrace <session.jsonl>           Render a single session (Claude Code or Codex, auto-detected)
  telltrace <dir>                     Pick the most recent .jsonl in a dir
  telltrace --latest                  Latest session across ~/.claude and ~/.codex
  telltrace --latest claude           Latest Claude Code session only
  telltrace --latest codex            Latest Codex session only

Options:
  -o, --output <path>                 Write HTML to path (default: ./trace.html)
  --open                              Open the rendered HTML when done
  -h, --help                          Show this help
`);
  process.exit(0);
}

let inputPath = null;
let outputPath = './trace.html';
let openAfter = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-o' || a === '--output') {
    outputPath = args[++i];
  } else if (a === '--open') {
    openAfter = true;
  } else if (a === '--latest') {
    const which = args[i + 1] === 'claude' || args[i + 1] === 'codex' ? args[++i] : 'any';
    inputPath = findLatestSession(which);
  } else if (!a.startsWith('-')) {
    inputPath = a;
  }
}

if (!inputPath) {
  process.stderr.write('telltrace: no input session provided\n');
  process.exit(1);
}

if (!existsSync(inputPath)) {
  process.stderr.write(`telltrace: not found: ${inputPath}\n`);
  process.exit(1);
}

const resolved = resolveInput(inputPath);
const raw = readFileSync(resolved, 'utf8');
const session = looksLikeCodexSession(raw)
  ? parseCodexSession(raw, { sourcePath: resolved })
  : parseSession(raw, { sourcePath: resolved });
const html = renderHTML(session);

writeFileSync(outputPath, html, 'utf8');
process.stdout.write(`telltrace: wrote ${outputPath} (${session.events.length} events)\n`);

if (openAfter) {
  const { spawn } = await import('node:child_process');
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [outputPath], { detached: true, stdio: 'ignore' }).unref();
}

function resolveInput(p) {
  const abs = resolve(p);
  const stat = statSync(abs);
  if (stat.isDirectory()) {
    const candidates = readdirSync(abs)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ f, mtime: statSync(join(abs, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (candidates.length === 0) {
      process.stderr.write(`telltrace: no .jsonl files in ${abs}\n`);
      process.exit(1);
    }
    return join(abs, candidates[0].f);
  }
  return abs;
}

function findLatestSession(which = 'any') {
  const home = process.env.HOME || process.env.USERPROFILE;
  const roots = [];
  if (which !== 'codex') roots.push(join(home, '.claude', 'projects'));
  if (which !== 'claude') roots.push(join(home, '.codex', 'sessions'));
  let best = null;
  const walk = (dir, depth) => {
    for (const f of readdirSync(dir)) {
      const full = join(dir, f);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (depth < 4) walk(full, depth + 1);
      } else if (f.endsWith('.jsonl')) {
        if (!best || stat.mtimeMs > best.mtime) best = { full, mtime: stat.mtimeMs };
      }
    }
  };
  for (const root of roots) {
    if (existsSync(root)) walk(root, 0);
  }
  return best?.full ?? null;
}
