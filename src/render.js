const ACTION_COLOR = {
  read:   '#5b9bd5',
  edit:   '#e8a33d',
  write:  '#d96666',
  bash:   '#7ab87a',
  agent:  '#a875d6',
  search: '#9aa0a6',
  web:    '#2dbab0',
  other:  '#888',
};

const ACTION_ICON = {
  read:   '👁',
  edit:   '✎',
  write:  '✍',
  bash:   '$',
  agent:  '⚙',
  search: '⌕',
  web:    '🌐',
  other:  '•',
};

export function renderHTML(session) {
  const { events, files, model, startedAt, endedAt, sourcePath } = session;
  const promptCount = events.filter(e => e.type === 'prompt').length;
  const toolCount = events.filter(e => e.type === 'tool_call').length;
  const duration = formatDuration(startedAt, endedAt);
  const groups = groupByPrompt(events);

  const mermaid = buildMermaid(groups);
  const timelineSvg = buildTimeline(files, events);
  const groupsHtml = groups.map(renderGroup).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Telltrace — ${escapeHtml(basename(sourcePath))}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; margin: 0; padding: 0; background: #0d1117; color: #e6edf3; }
  header { padding: 24px 32px; border-bottom: 1px solid #30363d; background: linear-gradient(180deg, #161b22, #0d1117); }
  header h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: -0.01em; }
  header .sub { color: #8b949e; font-size: 13px; }
  .stats { display: flex; gap: 24px; margin-top: 14px; flex-wrap: wrap; }
  .stat { display: flex; flex-direction: column; }
  .stat .v { font-size: 20px; font-weight: 600; }
  .stat .l { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.05em; }
  main { padding: 24px 32px; max-width: 1400px; }
  section { margin-bottom: 40px; }
  section h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #8b949e; margin: 0 0 12px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 18px; }
  .group { margin-bottom: 16px; }
  .group .prompt { background: #1f2733; border: 1px solid #30363d; border-radius: 8px; padding: 14px 16px; margin-bottom: 8px; }
  .group .prompt .label { font-size: 11px; text-transform: uppercase; color: #8b949e; letter-spacing: 0.08em; margin-bottom: 4px; }
  .group .prompt .text { white-space: pre-wrap; word-break: break-word; font-size: 14px; }
  .calls { margin-left: 16px; border-left: 2px solid #30363d; padding-left: 14px; }
  .call { display: flex; gap: 10px; padding: 6px 0; align-items: flex-start; font-size: 13px; }
  .call .icon { width: 22px; height: 22px; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; font-size: 12px; }
  .call .body { min-width: 0; flex: 1; }
  .call .tool { font-weight: 600; }
  .call .arg { color: #8b949e; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; word-break: break-all; }
  .file-strip { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  details summary { cursor: pointer; padding: 4px 0; color: #8b949e; font-size: 12px; }
  details[open] summary { color: #e6edf3; }
  pre { background: #0d1117; border: 1px solid #30363d; border-radius: 4px; padding: 10px; overflow-x: auto; font-size: 12px; max-height: 300px; }
  .timeline-wrap { overflow-x: auto; }
  .mermaid { background: #0d1117; padding: 12px; border-radius: 8px; overflow: auto; }
  svg text { fill: #e6edf3; }
  a { color: #58a6ff; }
  footer { padding: 24px 32px; color: #6e7681; font-size: 12px; border-top: 1px solid #30363d; }
</style>
</head>
<body>
<header>
  <h1>Telltrace</h1>
  <div class="sub">${escapeHtml(basename(sourcePath))} ${model ? `· <code>${escapeHtml(model)}</code>` : ''}</div>
  <div class="stats">
    <div class="stat"><div class="v">${promptCount}</div><div class="l">Prompts</div></div>
    <div class="stat"><div class="v">${toolCount}</div><div class="l">Tool calls</div></div>
    <div class="stat"><div class="v">${files.length}</div><div class="l">Files touched</div></div>
    <div class="stat"><div class="v">${duration}</div><div class="l">Duration</div></div>
  </div>
</header>
<main>
  <section>
    <h2>Flow</h2>
    <div class="card mermaid"><pre class="mermaid-src">${mermaid}</pre></div>
  </section>

  <section>
    <h2>File touches</h2>
    <div class="card timeline-wrap">${timelineSvg}</div>
  </section>

  <section>
    <h2>Session</h2>
    ${groupsHtml}
  </section>
</main>
<footer>
  Rendered by <a href="https://github.com/telltrace-dev">telltrace</a> · open source agent session viewer.
</footer>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: false, theme: 'dark', flowchart: { curve: 'basis' } });
  for (const el of document.querySelectorAll('.mermaid')) {
    const src = el.querySelector('.mermaid-src').textContent;
    try {
      const { svg } = await mermaid.render('m-' + Math.floor(performance.now()), src);
      el.innerHTML = svg;
    } catch (e) {
      el.innerHTML = '<div style="color:#f85149">mermaid render failed: ' + e.message + '</div>';
    }
  }
</script>
</body>
</html>`;
}

function groupByPrompt(events) {
  const groups = [];
  let current = null;
  for (const e of events) {
    if (e.type === 'prompt') {
      current = { prompt: e, calls: [], texts: [] };
      groups.push(current);
    } else if (current) {
      if (e.type === 'tool_call') current.calls.push(e);
      else if (e.type === 'assistant_text') current.texts.push(e);
    }
  }
  if (groups.length === 0 && events.length > 0) {
    groups.push({
      prompt: { text: '(no user prompt captured)', timestamp: null },
      calls: events.filter(e => e.type === 'tool_call'),
      texts: events.filter(e => e.type === 'assistant_text'),
    });
  }
  return groups;
}

function buildMermaid(groups) {
  const lines = ['flowchart TD'];
  groups.forEach((g, gi) => {
    const pid = `P${gi}`;
    const label = sanitizeMermaid(truncate(g.prompt.text ?? '(prompt)', 60));
    lines.push(`  ${pid}["${label}"]:::prompt`);
    g.calls.forEach((c, ci) => {
      const cid = `C${gi}_${ci}`;
      const file = c.file ? ` ${basename(c.file)}` : '';
      const node = sanitizeMermaid(`${c.tool}${file}`.slice(0, 50));
      lines.push(`  ${cid}["${node}"]:::${c.action}`);
      lines.push(`  ${pid} --> ${cid}`);
    });
  });
  lines.push('  classDef prompt fill:#1f6feb,stroke:#1f6feb,color:#fff');
  for (const [action, color] of Object.entries(ACTION_COLOR)) {
    lines.push(`  classDef ${action} fill:${color},stroke:${color},color:#fff`);
  }
  return lines.join('\n');
}

function buildTimeline(files, events) {
  if (files.length === 0) {
    return '<div style="color:#8b949e;padding:20px;text-align:center">No file activity in this session.</div>';
  }
  const sorted = [...files].sort((a, b) => b.events.length - a.events.length);
  const rowH = 22;
  const labelW = 240;
  const padding = 16;
  const calls = events.filter(e => e.type === 'tool_call' && e.file);
  const w = Math.max(800, calls.length * 18 + labelW + padding * 2);
  const h = sorted.length * rowH + padding * 2 + 30;
  const x0 = labelW + padding;
  const xStep = (w - x0 - padding) / Math.max(calls.length, 1);
  const callIndex = new Map();
  calls.forEach((c, i) => callIndex.set(c, i));

  let svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" style="display:block;">`;
  svg += `<rect width="${w}" height="${h}" fill="#0d1117"/>`;
  sorted.forEach((file, i) => {
    const y = padding + i * rowH + rowH / 2;
    const label = truncate(file.file, 36);
    svg += `<text x="${labelW + padding - 8}" y="${y + 4}" text-anchor="end" font-family="ui-monospace,Menlo,monospace" font-size="11" fill="#8b949e">${escapeXml(label)}</text>`;
    svg += `<line x1="${x0}" y1="${y}" x2="${w - padding}" y2="${y}" stroke="#21262d" stroke-width="1"/>`;
    for (const ev of file.events) {
      const matching = calls.find(c => c.file === file.file && c.timestamp === ev.ts && c.tool === ev.tool);
      const idx = matching ? callIndex.get(matching) : 0;
      const cx = x0 + idx * xStep + xStep / 2;
      const color = ACTION_COLOR[ev.action] ?? '#888';
      svg += `<circle cx="${cx}" cy="${y}" r="5" fill="${color}"><title>${escapeXml(ev.tool)} — ${escapeXml(ev.ts ?? '')}</title></circle>`;
    }
  });
  const legendY = h - 18;
  let lx = labelW + padding;
  for (const [action, color] of Object.entries(ACTION_COLOR)) {
    svg += `<circle cx="${lx}" cy="${legendY}" r="4" fill="${color}"/>`;
    svg += `<text x="${lx + 8}" y="${legendY + 4}" font-size="10" fill="#8b949e">${action}</text>`;
    lx += 60;
  }
  svg += '</svg>';
  return svg;
}

function renderGroup(g, i) {
  const promptText = escapeHtml(g.prompt.text ?? '');
  const calls = g.calls.map(renderCall).join('');
  return `<div class="group">
    <div class="prompt">
      <div class="label">Prompt ${i + 1}${g.prompt.timestamp ? ` · ${escapeHtml(g.prompt.timestamp)}` : ''}</div>
      <div class="text">${promptText}</div>
    </div>
    <div class="calls">${calls || '<div style="color:#6e7681;font-size:12px">no tool calls</div>'}</div>
  </div>`;
}

function renderCall(c) {
  const color = ACTION_COLOR[c.action] ?? '#888';
  const icon = ACTION_ICON[c.action] ?? '•';
  const argSummary = summarizeArgs(c.tool, c.args);
  return `<div class="call">
    <span class="icon" style="background:${color}">${icon}</span>
    <div class="body">
      <span class="tool">${escapeHtml(c.tool)}</span>
      <span class="arg">${escapeHtml(argSummary)}</span>
    </div>
  </div>`;
}

function summarizeArgs(tool, args) {
  if (!args || typeof args !== 'object') return '';
  if (args.file_path) return args.file_path;
  if (args.path) return args.path;
  if (args.command) return truncate(args.command, 120);
  if (args.pattern) return args.pattern;
  if (args.query) return truncate(args.query, 100);
  if (args.prompt) return truncate(args.prompt, 100);
  if (args.url) return args.url;
  const first = Object.entries(args)[0];
  return first ? `${first[0]}=${truncate(String(first[1]), 80)}` : '';
}

function sanitizeMermaid(s) {
  return String(s).replace(/["`]/g, "'").replace(/[\n\r]/g, ' ');
}

function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function escapeXml(s) {
  return escapeHtml(s);
}

function basename(p) {
  if (!p) return 'session';
  return String(p).split('/').pop();
}

function formatDuration(start, end) {
  if (!start || !end) return '—';
  const ms = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
