export function parseSession(raw, { sourcePath = null } = {}) {
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  const events = [];
  const sideEntries = [];
  const filesTouched = new Map();
  const touch = (e) => {
    const existing = filesTouched.get(e.file) ?? { file: e.file, events: [] };
    existing.events.push({ tool: e.tool, ts: e.timestamp, action: e.action });
    filesTouched.set(e.file, existing);
  };
  let model = null;
  let firstTs = null;
  let lastTs = null;
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const usageByModel = new Map();

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
    const entryModel = entry.message?.model ?? entry.model ?? null;
    if (entryModel && !model) model = entryModel;
    const u = entry.message?.usage;
    if (u) {
      const add = (target) => {
        target.input += u.input_tokens ?? 0;
        target.output += u.output_tokens ?? 0;
        target.cacheRead += u.cache_read_input_tokens ?? 0;
        target.cacheWrite += u.cache_creation_input_tokens ?? 0;
      };
      add(usage);
      const key = entryModel ?? 'unknown';
      if (!usageByModel.has(key)) usageByModel.set(key, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      add(usageByModel.get(key));
    }

    // Older Claude Code versions record subagent work inline as sidechain
    // entries; route them into their own threads instead of the main feed.
    if (entry.isSidechain === true) {
      sideEntries.push(entry);
      continue;
    }

    const norm = normalizeEntry(entry, entryModel);
    for (const e of norm) {
      events.push(e);
      if (e.type === 'tool_call' && e.file) touch(e);
    }
  }

  if (events.length === 0 && sideEntries.length > 0) {
    // The whole file is sidechain: it IS a subagent transcript (the
    // agent-<id>.jsonl layout). Treat its entries as the main thread.
    for (const entry of sideEntries) {
      for (const e of normalizeEntry(entry, entry.message?.model ?? null)) {
        events.push(e);
        if (e.type === 'tool_call' && e.file) touch(e);
      }
    }
  } else {
    for (const thread of buildSideThreads(sideEntries)) {
      const candidates = events.filter(e => e.type === 'tool_call' && isAgentTool(e.tool) && !e.sub);
      const target = candidates.find(e => e.args?.prompt === thread.prompt) ?? candidates[0];
      if (target) target.sub = { prompt: thread.prompt, events: thread.events };
      for (const e of thread.events) {
        if (e.type === 'tool_call' && e.file) touch(e);
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
    usageByModel: Object.fromEntries(usageByModel),
  };
}

function isAgentTool(tool) {
  const t = String(tool ?? '').toLowerCase();
  return t === 'task' || t === 'agent' || t.startsWith('agent');
}

// Group inline sidechain entries into per-agent threads: by agentId when
// present, otherwise by following parentUuid chains in file order.
function buildSideThreads(entries) {
  const groups = new Map();
  const uuidToKey = new Map();
  let n = 0;
  for (const entry of entries) {
    const key = entry.agentId ?? uuidToKey.get(entry.parentUuid) ?? `g${n++}`;
    if (entry.uuid) uuidToKey.set(entry.uuid, key);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.values()].map(list => {
    const evs = list.flatMap(e => normalizeEntry(e, e.message?.model ?? null));
    const promptEv = evs.find(x => x.type === 'prompt');
    return { prompt: promptEv?.text ?? '', events: evs.filter(x => x !== promptEv) };
  });
}

// Newer Claude Code stores each subagent as <session>/subagents/agent-<id>.jsonl
// plus a .meta.json whose toolUseId points at the spawning Agent/Task call.
export function attachSubagentFiles(session, subs) {
  const byId = new Map(subs.filter(s => s.toolUseId).map(s => [s.toolUseId, s]));
  const walk = (events) => {
    for (const e of events) {
      if (e.type !== 'tool_call' || e.sub) continue;
      const sub = byId.get(e.toolUseId);
      if (!sub) continue;
      const sEvents = sub.session.events;
      const promptEv = sEvents.find(x => x.type === 'prompt');
      e.sub = {
        agentType: sub.agentType ?? null,
        description: sub.description ?? null,
        model: sub.model ?? null,
        prompt: promptEv?.text ?? '',
        events: sEvents.filter(x => x !== promptEv),
      };
      mergeUsage(session, sub.session);
      mergeFiles(session, sub.session);
      walk(e.sub.events);
    }
  };
  walk(session.events);
}

function mergeUsage(session, sub) {
  for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) session.usage[k] += sub.usage[k];
  for (const [m, u] of Object.entries(sub.usageByModel ?? {})) {
    const target = session.usageByModel[m] ?? (session.usageByModel[m] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) target[k] += u[k];
  }
}

function mergeFiles(session, sub) {
  const byFile = new Map(session.files.map(f => [f.file, f]));
  for (const f of sub.files) {
    const existing = byFile.get(f.file);
    if (existing) existing.events.push(...f.events);
    else {
      byFile.set(f.file, f);
      session.files.push(f);
    }
  }
}

function normalizeEntry(entry, entryModel) {
  const ts = entry.timestamp ?? entry.time ?? null;
  const out = [];

  if (entry.type === 'user' || entry.role === 'user') {
    const text = cleanPromptText(extractText(entry.message?.content ?? entry.content));
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
        out.push({ type: 'assistant_text', timestamp: ts, text: block.text, id: entry.uuid, model: entryModel });
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
          diff: extractDiff(tool, args),
          id: entry.uuid,
          model: entryModel,
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

// Local-command echoes, caveats, and system reminders are harness noise, not prompts.
function cleanPromptText(text) {
  if (!text) return '';
  let t = String(text)
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
    .trim();
  if (!t) return '';
  if (
    t.startsWith('<command-name>') ||
    t.startsWith('<local-command-stdout>') ||
    t.startsWith('<local-command-caveat>') ||
    t.startsWith('Caveat: The messages below were generated by the user while running local commands') ||
    t.startsWith('[Request interrupted')
  ) {
    return '';
  }
  return t;
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

// Signed diff lines for edit-like tools: s is '+', '-', ' ' (context) or '~' (meta).
export const MAX_DIFF_LINES = 80;

function extractDiff(tool, args) {
  if (!args || typeof args !== 'object') return null;
  const t = String(tool ?? '').toLowerCase();
  if (t === 'edit') return editDiff([args]);
  if (t === 'multiedit' && Array.isArray(args.edits)) return editDiff(args.edits);
  if (t === 'write' && typeof args.content === 'string') {
    return capDiff(args.content.split('\n').map(l => ({ s: '+', t: l })));
  }
  if (t === 'notebookedit' && typeof args.new_source === 'string') {
    return capDiff(args.new_source.split('\n').map(l => ({ s: '+', t: l })));
  }
  return null;
}

function editDiff(edits) {
  const lines = [];
  for (const e of edits) {
    if (!e || typeof e !== 'object') continue;
    if (lines.length) lines.push({ s: '~', t: '⋯' });
    const oldS = String(e.old_string ?? '');
    const newS = String(e.new_string ?? '');
    if (oldS) for (const l of oldS.split('\n')) lines.push({ s: '-', t: l });
    if (newS) for (const l of newS.split('\n')) lines.push({ s: '+', t: l });
  }
  return capDiff(lines);
}

export function capDiff(lines) {
  if (!lines.length) return null;
  if (lines.length > MAX_DIFF_LINES) {
    const extra = lines.length - MAX_DIFF_LINES;
    lines = lines.slice(0, MAX_DIFF_LINES);
    lines.push({ s: '~', t: `… ${extra} more lines` });
  }
  return lines;
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
