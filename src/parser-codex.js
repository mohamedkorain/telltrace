import { capDiff } from './parser.js';

const CODEX_LINE_TYPES = new Set(['session_meta', 'response_item', 'event_msg', 'turn_context', 'compacted']);

export function looksLikeCodexSession(raw) {
  for (const line of String(raw).split('\n')) {
    if (!line.trim()) continue;
    try {
      return CODEX_LINE_TYPES.has(JSON.parse(line).type);
    } catch {
      continue;
    }
  }
  return false;
}

export function parseCodexSession(raw, { sourcePath = null } = {}) {
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  const events = [];
  const filesTouched = new Map();
  let model = null;
  let currentModel = null;
  let project = null;
  let firstTs = null;
  let lastTs = null;
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const usageByModel = new Map();

  const touch = (file, tool, ts, action) => {
    const existing = filesTouched.get(file) ?? { file, events: [] };
    existing.events.push({ tool, ts, action });
    filesTouched.set(file, existing);
  };

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = entry.timestamp ?? null;
    if (ts) {
      if (!firstTs) firstTs = ts;
      lastTs = ts;
    }
    const p = entry.payload ?? {};

    if (entry.type === 'session_meta') {
      if (p.cwd) project = String(p.cwd).split('/').filter(Boolean).pop() ?? null;
      continue;
    }

    if (entry.type === 'turn_context') {
      if (p.model) {
        currentModel = p.model;
        if (!model) model = p.model;
      }
      continue;
    }

    if (entry.type === 'event_msg') {
      if (p.type === 'user_message') {
        const text = cleanCodexPrompt(p.message);
        if (text) events.push({ type: 'prompt', timestamp: ts, text });
      } else if (p.type === 'agent_message') {
        if (p.message?.trim()) {
          events.push({ type: 'assistant_text', timestamp: ts, text: p.message, model: currentModel });
        }
      } else if (p.type === 'token_count') {
        const u = p.info?.last_token_usage;
        if (u) {
          const cached = u.cached_input_tokens ?? 0;
          const add = (target) => {
            target.input += Math.max(0, (u.input_tokens ?? 0) - cached);
            target.output += u.output_tokens ?? 0;
            target.cacheRead += cached;
          };
          add(usage);
          const key = currentModel ?? 'unknown';
          if (!usageByModel.has(key)) usageByModel.set(key, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
          add(usageByModel.get(key));
        }
      }
      continue;
    }

    if (entry.type !== 'response_item') continue;

    if (p.type === 'reasoning') {
      const text = (p.summary ?? [])
        .map(s => s?.text ?? '')
        .join('\n')
        .trim();
      if (text) events.push({ type: 'assistant_text', timestamp: ts, text, model: currentModel });
    } else if (p.type === 'function_call') {
      const tool = p.name ?? 'tool';
      const args = normalizeArgs(tool, parseArgs(p.arguments));
      const file = args.file_path ?? args.path ?? null;
      const action = codexAction(tool);
      events.push({ type: 'tool_call', timestamp: ts, tool, args, toolUseId: p.call_id, file, action, model: currentModel });
      if (file) touch(file, tool, ts, action);
    } else if (p.type === 'custom_tool_call') {
      const tool = p.name ?? 'tool';
      const action = codexAction(tool);
      const files = tool === 'apply_patch' ? patchFiles(p.input) : [];
      const args = files.length ? { file_path: files[0] } : { input: String(p.input ?? '').slice(0, 200) };
      const diff = tool === 'apply_patch' ? patchDiff(p.input) : null;
      events.push({ type: 'tool_call', timestamp: ts, tool, args, toolUseId: p.call_id, file: files[0] ?? null, action, diff, model: currentModel });
      for (const f of files) touch(f, tool, ts, action);
    } else if (p.type === 'web_search_call') {
      const query = p.action?.query ?? '';
      events.push({ type: 'tool_call', timestamp: ts, tool: 'web_search', args: { query }, toolUseId: p.call_id ?? null, file: null, action: 'web', model: currentModel });
    } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      const out = typeof p.output === 'string' ? p.output : p.output?.content ?? '';
      events.push({ type: 'tool_result', timestamp: ts, toolUseId: p.call_id, text: String(out).slice(0, 4000) });
    }
  }

  return {
    sourcePath,
    agent: 'codex',
    agentName: 'Codex',
    project,
    model,
    startedAt: firstTs,
    endedAt: lastTs,
    events,
    files: [...filesTouched.values()],
    usage,
    usageByModel: Object.fromEntries(usageByModel),
  };
}

// Harness-injected context blocks arrive as user messages; they are not prompts.
function cleanCodexPrompt(text) {
  if (!text) return '';
  const t = String(text).trim();
  if (
    t.startsWith('<user_instructions>') ||
    t.startsWith('<environment_context>') ||
    t.startsWith('<ENVIRONMENT_CONTEXT>') ||
    t.startsWith('<permissions instructions>') ||
    t.startsWith('<turn_aborted>') ||
    t.startsWith('[Request interrupted')
  ) {
    return '';
  }
  return t;
}

function parseArgs(argstr) {
  if (argstr && typeof argstr === 'object') return argstr;
  try {
    const parsed = JSON.parse(argstr);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// Present codex args with the key names the renderer already summarizes.
function normalizeArgs(tool, args) {
  const out = { ...args };
  if (out.cmd && !out.command) {
    out.command = Array.isArray(out.cmd) ? out.cmd.join(' ') : out.cmd;
    delete out.cmd;
  }
  if (Array.isArray(out.command)) {
    const c = out.command;
    out.command = c[0] === 'bash' && c[1] === '-lc' ? c.slice(2).join(' ') : c.join(' ');
  }
  return out;
}

function codexAction(tool) {
  const t = String(tool ?? '').toLowerCase();
  if (t === 'apply_patch') return 'edit';
  if (t === 'exec_command' || t === 'shell' || t === 'local_shell' || t === 'write_stdin') return 'bash';
  if (t === 'read_file' || t === 'view_image') return 'read';
  if (t.includes('search') || t.includes('grep') || t.includes('glob')) return 'search';
  if (t.includes('web') || t.includes('fetch')) return 'web';
  if (t.includes('agent') || t === 'task') return 'agent';
  return 'other';
}

function patchDiff(input) {
  const lines = [];
  for (const raw of String(input ?? '').split('\n')) {
    if (raw.startsWith('*** Begin Patch') || raw.startsWith('*** End Patch') || !raw.trim()) continue;
    if (raw.startsWith('*** ')) lines.push({ s: '~', t: raw.slice(4) });
    else if (raw.startsWith('@@')) lines.push({ s: '~', t: raw });
    else if (raw.startsWith('+')) lines.push({ s: '+', t: raw.slice(1) });
    else if (raw.startsWith('-')) lines.push({ s: '-', t: raw.slice(1) });
    else lines.push({ s: ' ', t: raw.startsWith(' ') ? raw.slice(1) : raw });
  }
  return capDiff(lines);
}

function patchFiles(input) {
  const files = [];
  const re = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
  let m;
  while ((m = re.exec(String(input ?? ''))) !== null) files.push(m[1].trim());
  return files;
}
