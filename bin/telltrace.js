#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { parseSession } from '../src/parser.js';
import { renderHTML } from '../src/render.js';

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
  process.stdout.write(`telltrace — visualize what an agent built

Usage:
  telltrace <session.jsonl>           Render a single session
  telltrace <dir>                     Pick the most recent .jsonl in a dir
  telltrace --latest                  Find latest Claude Code session in ~/.claude

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
    inputPath = findLatestClaudeSession();
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
const session = parseSession(raw, { sourcePath: resolved });
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

function findLatestClaudeSession() {
  const home = process.env.HOME || process.env.USERPROFILE;
  const root = join(home, '.claude', 'projects');
  if (!existsSync(root)) return null;
  let best = null;
  for (const dir of readdirSync(root)) {
    const projectDir = join(root, dir);
    if (!statSync(projectDir).isDirectory()) continue;
    for (const f of readdirSync(projectDir)) {
      if (!f.endsWith('.jsonl')) continue;
      const full = join(projectDir, f);
      const mtime = statSync(full).mtimeMs;
      if (!best || mtime > best.mtime) best = { full, mtime };
    }
  }
  return best?.full ?? null;
}
