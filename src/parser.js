export function parseSession(raw, { sourcePath = null } = {}) {
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  const events = [];
  const filesTouched = new Map();
  let model = null;
  let firstTs = null;
  let lastTs = null;
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = entry.timestamp ?? entry.time ?? null;
    if (ts) {
      if (!firstTs) firstTs = ts;
      lastTs = ts;
    }
    if (entry.model && !model) model = entry.model;
    if (!model && entry.message?.model) model = entry.message.model;
    const u = entry.message?.usage;
    if (u) {
      usage.input += u.input_tokens ?? 0;
      usage.output += u.output_tokens ?? 0;
      usage.cacheRead += u.cache_read_input_tokens ?? 0;
      usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
    }

    const norm = normalizeEntry(entry);
    for (const e of norm) {
      events.push(e);
      if (e.type === 'tool_call' && e.file) {
        const existing = filesTouched.get(e.file) ?? { file: e.file, events: [] };
        existing.events.push({ tool: e.tool, ts: e.timestamp, action: e.action });
        filesTouched.set(e.file, existing);
      }
    }
  }

  return {
    sourcePath,
    model,
    startedAt: firstTs,
    endedAt: lastTs,
    events,
    files: [...filesTouched.values()],
    usage,
  };
}

function normalizeEntry(entry) {
  const ts = entry.timestamp ?? entry.time ?? null;
  const out = [];

  if (entry.type === 'user' || entry.role === 'user') {
    const text = extractText(entry.message?.content ?? entry.content);
    if (text && !looksLikeToolResult(entry)) {
      out.push({ type: 'prompt', timestamp: ts, text, id: entry.uuid ?? entry.id });
    } else if (looksLikeToolResult(entry)) {
      out.push({
        type: 'tool_result',
        timestamp: ts,
        toolUseId: extractToolUseId(entry),
        text: text?.slice(0, 4000),
        id: entry.uuid ?? entry.id,
      });
    }
    return out;
  }

  if (entry.type === 'assistant' || entry.role === 'assistant') {
    const content = entry.message?.content ?? entry.content ?? [];
    const blocks = Array.isArray(content) ? content : [{ type: 'text', text: String(content) }];
    for (const block of blocks) {
      if (block.type === 'text' && block.text?.trim()) {
        out.push({ type: 'assistant_text', timestamp: ts, text: block.text, id: entry.uuid });
      } else if (block.type === 'tool_use') {
        const tool = block.name;
        const args = block.input ?? {};
        out.push({
          type: 'tool_call',
          timestamp: ts,
          tool,
          args,
          toolUseId: block.id,
          file: extractFileFromArgs(tool, args),
          action: extractActionFromTool(tool),
          id: entry.uuid,
        });
      }
    }
    return out;
  }

  if (entry.type === 'summary' && entry.summary) {
    out.push({ type: 'summary', timestamp: ts, text: entry.summary });
  }

  return out;
}

function extractText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(c => {
        if (typeof c === 'string') return c;
        if (c.type === 'text') return c.text ?? '';
        if (c.type === 'tool_result') {
          const inner = c.content;
          if (typeof inner === 'string') return inner;
          if (Array.isArray(inner)) return inner.map(x => x.text ?? '').join('\n');
        }
        return '';
      })
      .join('\n')
      .trim();
  }
  return '';
}

function looksLikeToolResult(entry) {
  const content = entry.message?.content ?? entry.content;
  if (!Array.isArray(content)) return false;
  return content.some(c => c?.type === 'tool_result');
}

function extractToolUseId(entry) {
  const content = entry.message?.content ?? entry.content;
  if (!Array.isArray(content)) return null;
  const tr = content.find(c => c?.type === 'tool_result');
  return tr?.tool_use_id ?? null;
}

function extractFileFromArgs(tool, args) {
  if (!args || typeof args !== 'object') return null;
  return args.file_path ?? args.path ?? args.notebook_path ?? null;
}

function extractActionFromTool(tool) {
  if (!tool) return 'other';
  const t = tool.toLowerCase();
  if (t === 'read') return 'read';
  if (t === 'edit' || t === 'multiedit') return 'edit';
  if (t === 'write') return 'write';
  if (t === 'bash') return 'bash';
  if (t.startsWith('agent') || t === 'task') return 'agent';
  if (t.includes('grep') || t.includes('search') || t.includes('glob')) return 'search';
  if (t.includes('fetch') || t.includes('web')) return 'web';
  return 'other';
}
