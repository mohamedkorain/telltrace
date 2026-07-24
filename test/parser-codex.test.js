import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCodexSession, looksLikeCodexSession } from '../src/parser-codex.js';
import { parseSession, attachSubagentFiles } from '../src/parser.js';
import { renderHTML } from '../src/render.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const codexRaw = readFileSync(join(root, 'samples', 'demo-codex-session.jsonl'), 'utf8');
const claudeRaw = readFileSync(join(root, 'samples', 'demo-session.jsonl'), 'utf8');

test('detects codex vs claude sessions', () => {
  assert.equal(looksLikeCodexSession(codexRaw), true);
  assert.equal(looksLikeCodexSession(claudeRaw), false);
});

test('parses a codex session into the normalized shape', () => {
  const s = parseCodexSession(codexRaw, { sourcePath: '/x/rollout-demo.jsonl' });
  assert.equal(s.agent, 'codex');
  assert.equal(s.agentName, 'Codex');
  assert.equal(s.project, 'orbit');
  assert.equal(s.model, 'gpt-5.5');

  const prompts = s.events.filter(e => e.type === 'prompt');
  assert.equal(prompts.length, 1);
  assert.match(prompts[0].text, /--json flag/);

  const calls = s.events.filter(e => e.type === 'tool_call');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].tool, 'exec_command');
  assert.equal(calls[0].action, 'bash');
  assert.match(calls[0].args.command, /grep -n/);
  assert.equal(calls[1].tool, 'apply_patch');
  assert.equal(calls[1].action, 'edit');
  assert.equal(calls[1].file, 'src/cli.js');

  const results = s.events.filter(e => e.type === 'tool_result');
  assert.equal(results.length, 2);
  assert.equal(results[0].toolUseId, 'call_001');

  assert.equal(s.files.length, 1);
  assert.equal(s.files[0].file, 'src/cli.js');

  assert.equal(s.usage.cacheRead, 6000);
  assert.equal(s.usage.input, 3000);
  assert.equal(s.usage.output, 450);
  assert.ok(s.usageByModel['gpt-5.5']);
});

test('filters harness-injected user messages', () => {
  const raw = [
    JSON.stringify({ timestamp: 't', type: 'event_msg', payload: { type: 'user_message', message: '<environment_context>stuff</environment_context>' } }),
    JSON.stringify({ timestamp: 't', type: 'event_msg', payload: { type: 'user_message', message: 'real prompt' } }),
  ].join('\n');
  const s = parseCodexSession(raw);
  const prompts = s.events.filter(e => e.type === 'prompt');
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].text, 'real prompt');
});

test('codex apply_patch carries a signed diff', () => {
  const s = parseCodexSession(codexRaw);
  const patch = s.events.find(e => e.type === 'tool_call' && e.tool === 'apply_patch');
  assert.ok(Array.isArray(patch.diff));
  assert.ok(patch.diff.some(l => l.s === '+' && l.t.includes('printJSON')));
  assert.ok(patch.diff.some(l => l.s === '-' && l.t.includes('printReport')));
});

test('claude Edit and Write tools carry diffs', () => {
  const raw = [
    JSON.stringify({ type: 'assistant', timestamp: 't', message: { content: [
      { type: 'tool_use', id: 'tu1', name: 'Edit', input: { file_path: '/a.js', old_string: 'foo()', new_string: 'bar()' } },
      { type: 'tool_use', id: 'tu2', name: 'Write', input: { file_path: '/b.js', content: 'line1\nline2' } },
      { type: 'tool_use', id: 'tu3', name: 'Read', input: { file_path: '/c.js' } },
    ] } }),
  ].join('\n');
  const s = parseSession(raw);
  const [edit, write, read] = s.events.filter(e => e.type === 'tool_call');
  assert.deepEqual(edit.diff, [{ s: '-', t: 'foo()' }, { s: '+', t: 'bar()' }]);
  assert.deepEqual(write.diff, [{ s: '+', t: 'line1' }, { s: '+', t: 'line2' }]);
  assert.equal(read.diff, null);
});

test('renders expandable diff blocks', () => {
  const html = renderHTML(parseCodexSession(codexRaw, { sourcePath: '/x/rollout-demo.jsonl' }));
  assert.match(html, /<details class="rund">/);
  assert.match(html, /class="dl add"/);
  assert.match(html, /class="dl del"/);
});

const mainWithAgent = [
  JSON.stringify({ type: 'user', timestamp: 't1', message: { role: 'user', content: 'build the thing' } }),
  JSON.stringify({ type: 'assistant', timestamp: 't2', message: { model: 'fable-5', usage: { input_tokens: 100, output_tokens: 50 }, content: [
    { type: 'tool_use', id: 'tu_agent_1', name: 'Agent', input: { prompt: 'explore the repo', subagent_type: 'Explore' } },
  ] } }),
].join('\n');

const subRaw = [
  JSON.stringify({ type: 'user', timestamp: 't3', isSidechain: true, agentId: 'a1', message: { role: 'user', content: 'explore the repo' } }),
  JSON.stringify({ type: 'assistant', timestamp: 't4', isSidechain: true, agentId: 'a1', message: { model: 'haiku', usage: { input_tokens: 10, output_tokens: 5 }, content: [
    { type: 'text', text: 'Looking around.' },
    { type: 'tool_use', id: 'tu_read', name: 'Read', input: { file_path: '/sub.js' } },
  ] } }),
].join('\n');

test('attaches file-based subagent transcripts by toolUseId', () => {
  const session = parseSession(mainWithAgent);
  attachSubagentFiles(session, [
    { toolUseId: 'tu_agent_1', agentType: 'Explore', model: 'haiku', session: parseSession(subRaw) },
  ]);
  const agentCall = session.events.find(e => e.type === 'tool_call' && e.tool === 'Agent');
  assert.equal(agentCall.sub.agentType, 'Explore');
  assert.equal(agentCall.sub.prompt, 'explore the repo');
  assert.equal(agentCall.sub.events.filter(e => e.type === 'tool_call').length, 1);
  assert.equal(session.usage.input, 110);
  assert.ok(session.files.some(f => f.file === '/sub.js'));
  assert.ok(session.usageByModel['haiku']);
});

test('attaches inline sidechain entries to the agent call', () => {
  const session = parseSession(mainWithAgent + '\n' + subRaw);
  const prompts = session.events.filter(e => e.type === 'prompt');
  assert.equal(prompts.length, 1, 'sidechain prompt must not become a main post');
  const agentCall = session.events.find(e => e.type === 'tool_call' && e.tool === 'Agent');
  assert.equal(agentCall.sub.prompt, 'explore the repo');
  assert.equal(agentCall.sub.events.filter(e => e.type === 'tool_call').length, 1);
  assert.ok(session.files.some(f => f.file === '/sub.js'));
});

test('renders nested subagent threads', () => {
  const session = parseSession(mainWithAgent);
  attachSubagentFiles(session, [
    { toolUseId: 'tu_agent_1', agentType: 'Explore', session: parseSession(subRaw) },
  ]);
  const html = renderHTML(session);
  assert.match(html, /class="subthread"/);
  assert.match(html, /1 ops · thread/);
  assert.match(html, /class="author claude-a">Explore</);
});

test('renders codex session with Codex byline', () => {
  const html = renderHTML(parseCodexSession(codexRaw, { sourcePath: '/x/rollout-demo.jsonl' }));
  assert.match(html, /<title>orbit · telltrace<\/title>/);
  assert.match(html, /class="author claude-a">Codex</);
});

test('renders claude session with Claude byline (unchanged)', () => {
  const html = renderHTML(parseSession(claudeRaw, { sourcePath: join(root, 'samples', 'demo-session.jsonl') }));
  assert.match(html, /class="author claude-a">Claude</);
});
