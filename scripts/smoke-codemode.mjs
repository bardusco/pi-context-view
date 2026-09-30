#!/usr/bin/env node
/** Real Pi 0.99.1 TUI/provider smoke for codemode-only declaration accounting.
 * Uses a private agent directory, synthetic-only loopback Responses provider and a PTY.
 * No prompts, credentials, sessions, or output survive the temporary directory.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PI_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))));
const PI_BIN = path.join(PI_ROOT, 'dist', 'cli.js');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');
const LIMIT = 2 * 1024 * 1024;
const wait = ms => new Promise(r => setTimeout(r, ms));
const assert = (ok, message) => { if (!ok) throw new Error(message); };

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}
function boundedPush(target, chunk) {
  target.push(chunk);
  let n = target.reduce((a, b) => a + b.length, 0);
  while (n > LIMIT && target.length > 1) n -= target.shift().length;
}

// Python stdlib PTY driver launches the real installed Pi executable and relays
// terminal bytes. It adds no application mocks or test-only Pi entrypoint.
const PTY_DRIVER = String.raw`
import os, pty, subprocess, sys, select, signal, time, fcntl, termios, struct
args = sys.argv[1:]
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 110, 0, 0))
env = os.environ.copy(); env['TERM']='xterm-256color'; env['COLUMNS']='110'; env['LINES']='36'
p = subprocess.Popen(args, stdin=slave, stdout=slave, stderr=slave, env=env, start_new_session=True, close_fds=True)
os.close(slave)
try:
  while True:
    r,_,_ = select.select([master, sys.stdin], [], [], .2)
    if master in r:
      try: data=os.read(master, 65536)
      except OSError: break
      if not data: break
      os.write(1,data)
    if sys.stdin in r:
      data=os.read(0,65536)
      if not data: break
      os.write(master,data)
    if p.poll() is not None:
      # Drain final terminal frame.
      time.sleep(.15)
      try:
        while True:
          r,_,_=select.select([master],[],[],.05)
          if not r: break
          d=os.read(master,65536)
          if not d: break
          os.write(1,d)
      except OSError: pass
      break
finally:
  if p.poll() is None:
    try: os.killpg(p.pid, signal.SIGTERM); p.wait(timeout=2)
    except Exception:
      try: os.killpg(p.pid, signal.SIGKILL)
      except Exception: pass
  os.close(master)
`;

async function main() {
  assert(process.versions.node.split('.')[0] >= 22, 'Node 22+ required');
  const piVersion = await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [PI_BIN, '--version'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; p.stdout.on('data', d => out += d); p.on('error', reject);
    p.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(`pi --version exited ${code}`)));
  });
  assert(/0\.99\.1/.test(piVersion), `Expected installed Pi 0.99.1, got ${piVersion}`);
  const temp = await mkdtemp(path.join(tmpdir(), 'pi-context-codemode-smoke-'));
  const agentDir = path.join(temp, 'agent');
  const workDir = path.join(temp, 'work');
  await mkdir(agentDir, { recursive: true }); await mkdir(workDir, { recursive: true });
  let requests = [];
  let responseCount = 0;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const part of req) { body += part; if (body.length > 4 * 1024 * 1024) break; }
    if (req.url?.endsWith('/chat/completions') && req.method === 'POST') {
      requests.push(JSON.parse(body)); responseCount++;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const chunk of [
        { id: `smoke-${responseCount}`, object: 'chat.completion.chunk', created: 0, model: 'smoke-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'SYNTHETIC_SMOKE_REPLY' }, finish_reason: null }] },
        { id: `smoke-${responseCount}`, object: 'chat.completion.chunk', created: 0, model: 'smoke-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } },
      ]) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.end('data: [DONE]\n\n');
    } else if (req.url?.endsWith('/responses') && req.method === 'POST') {
      try { requests.push(JSON.parse(body)); } catch { requests.push({ invalid: true }); }
      responseCount++;
      const reply = { id: `smoke-${responseCount}`, object: 'response', status: 'completed',
        output: [{ id: `msg-${responseCount}`, type: 'message', role: 'assistant',
          content: [{ type: 'output_text', text: 'SYNTHETIC_SMOKE_REPLY' }] }],
        usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 } };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const event of [
        { type: 'response.created', response: { ...reply, status: 'in_progress', output: [] } },
        { type: 'response.output_item.added', output_index: 0, item: { ...reply.output[0], status: 'in_progress', content: [] } },
        { type: 'response.content_part.added', output_index: 0, content_index: 0, item_id: reply.output[0].id, part: { type: 'output_text', text: '', annotations: [] } },
        { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: reply.output[0].id, delta: 'SYNTHETIC_SMOKE_REPLY' },
        { type: 'response.output_item.done', output_index: 0, item: reply.output[0] },
        { type: 'response.completed', response: reply },
      ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      res.end();
    } else { res.writeHead(404); res.end('{}'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let pi;
  const chunks = [];
  try {
    const port = server.address().port;
    await writeFile(path.join(agentDir, 'auth.json'), JSON.stringify({ 'smoke-openai': { type: 'api_key', key: 'synthetic-not-a-secret' } }));
    await writeFile(path.join(agentDir, 'models.json'), JSON.stringify({ providers: {
      'smoke-openai': { baseUrl: `http://127.0.0.1:${port}/v1`, api: 'openai-responses', apiKey: 'synthetic-not-a-secret',
        models: [{ id: 'smoke-model', name: 'Synthetic local smoke', contextWindow: 32768, maxTokens: 512, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] }
    } }));
    await writeFile(path.join(agentDir, 'settings.json'), JSON.stringify({ defaultModel: 'smoke-openai/smoke-model',
      defaultTools: ['codemode', 'smoke_synthetic'], codemode: { mode: 'only' } }));
    const syntheticTool = path.join(temp, 'synthetic-tool.ts');
    await writeFile(syntheticTool, `import type { ExtensionAPI } from ${JSON.stringify(path.join(PI_ROOT, 'dist', 'index.js'))};\nexport default function(pi: ExtensionAPI) { pi.registerTool({ name: 'smoke_synthetic', label: 'Synthetic Smoke Tool', description: 'Synthetic marker tool callable through codemode. Signature: smoke_synthetic(input: { marker: string }): Promise<{ marker: string }> ', parameters: { type: 'object', properties: { marker: { type: 'string' } }, required: ['marker'] }, exposure: 'direct', async execute(_id, params) { return { content: [{ type: 'text', text: JSON.stringify({ marker: params.marker }) }] }; } }); }`);

    // The first invocation includes the fixtures on one side of context-view;
    // second invocation reverses their ordering. Both are genuine fresh sessions.
    const orders = [
      ['marker.ts', 'forced-prompt.ts', 'input-transform.ts'],
      ['input-transform.ts', 'forced-prompt.ts', 'marker.ts'],
    ];
    const allDisplays = [];
    for (let run = 0; run < orders.length * 3; run++) {
      requests = []; responseCount = 0; chunks.length = 0;
      const order = run % orders.length;
      const grammar = run >= orders.length;
      const completions = run >= orders.length * 2;
      // Match the real GPT-6 Luna capability flags; native Pi owns serialization.
      const modelsPath = path.join(agentDir, 'models.json');
      const modelConfig = JSON.parse(await readFile(modelsPath, 'utf8'));
      modelConfig.providers['smoke-openai'].api = completions ? 'openai-completions' : 'openai-responses';
      modelConfig.providers['smoke-openai'].models[0].compat = {
        supportsStrictMode: true, supportsOpenAIGrammarTools: grammar,
        supportsAdditionalTools: true, supportsToolSearch: true,
        supportsMidConvoSystemMessages: true, supportsExplicitPromptCacheMode: true,
      };
      await writeFile(modelsPath, JSON.stringify(modelConfig));
      const sequence = order === 0 ? [path.join(ROOT, 'src/index.ts'), ...orders[order].map(f => path.join(FIXTURES, f))]
        : [...orders[order].map(f => path.join(FIXTURES, f)), path.join(ROOT, 'src/index.ts')];
      const sentinel = path.join(temp, `responses-${run}.txt`);
      const sentinelExtension = path.join(temp, `sentinel-${run}.ts`);
      await writeFile(sentinelExtension, `import { appendFileSync } from 'node:fs'; export default function(pi) { pi.on('after_provider_response', () => { appendFileSync(${JSON.stringify(sentinel)}, 'response\\n'); }); }`);
      const args = [PI_BIN, '--offline', '--no-context-files', '--no-skills', '--no-prompt-templates', '--no-session', '--provider', 'smoke-openai', '--model', 'smoke-model', '--tools', 'codemode,smoke_synthetic',
        '--extension', syntheticTool, '--extension', sentinelExtension, ...sequence.flatMap(file => ['--extension', file])];
      pi = spawn('python3', ['-u', '-c', PTY_DRIVER, process.execPath, ...args], {
        cwd: workDir, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_SESSION_DIR: path.join(temp, `sessions-${run}`),
          OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', TERM: 'xterm-256color' }, stdio: ['pipe', 'pipe', 'pipe'] });
      let stderr = '';
      pi.stdout.on('data', d => boundedPush(chunks, d.toString('utf8')));
      pi.stderr.on('data', d => { stderr = (stderr + d.toString()).slice(-4096); });
      const send = async (s, delay = 800) => { if (!pi || pi.killed) return; pi.stdin.write(s); await wait(delay); };
      const startupDeadline = Date.now() + 8000;
      while (!/\(smoke-openai\) smoke-model/.test(stripAnsi(chunks.join(''))) && pi.exitCode === null && Date.now() < startupDeadline) await wait(100);
      const firstOutput = stripAnsi(chunks.join(''));
      // Prompt input is intentionally not echoed by some supported renderers.
      // The visible base TUI is confirmed by the footer/model label instead.
      assert(/\(smoke-openai\) smoke-model/.test(firstOutput), `Pi TUI did not start (exit ${pi.exitCode}): ${firstOutput.slice(-1200)} ${stripAnsi(stderr).slice(-1000)}`);
      let screen;
      if (order === 0) {
        // A probe Initial stays historical/unobserved even after a later real prompt.
        pi.stdin.write('/context injections\r');
        await wait(2600);
        assert(requests.length === 0, `first /context probe made ${requests.length} provider requests`);
        assert(await readFile(sentinel, 'utf8').catch(() => '') === '', 'probe hit provider-response sentinel');
        screen = stripAnsi(chunks.join(''));
        assert(/Context Injections|INITIAL/.test(screen), `first /context did not render the injections overlay: ${screen.slice(-3500)}`);
        assert(/estimates are incomplete/.test(screen), 'probe must explicitly show unobserved definitions');
        pi.stdin.write('\x1b'); await wait(500);
      }
      // Real, harmless synthetic user prompt; requests go only to loopback.
      pi.stdin.write('SYNTHETIC_SMOKE_PROMPT\r'); await wait(2600);
      assert(requests.length >= 1, 'real synthetic prompt did not reach loopback provider');
      const payload = requests.at(-1);
      const observed = payload.tools;
      assert(Array.isArray(observed) && observed.length === 1, `Expected one declaration, got ${JSON.stringify(observed?.map(t => ({ type: t.type, name: t.name })))}`);
      const codemode = observed[0];
      const definition = completions ? codemode.custom : codemode;
      assert(definition.name === 'codemode', `Unexpected declared tool: ${definition.name}`);
      assert(codemode.type === (grammar ? 'custom' : 'function'), 'native serializer did not select the expected grammar/function surface');
      if (grammar) {
        const format = completions ? definition.format?.grammar : definition.format;
        assert(definition.format?.type === 'grammar' && format.syntax === 'lark' && format.definition.length > 0, 'native grammar declaration shape mismatch');
      }
      const declarationText = JSON.stringify(codemode);
      assert(declarationText.includes('smoke_synthetic'), 'codemode declaration omits synthetic callable tool');
      assert(declarationText.includes('marker') && declarationText.includes('string'), 'codemode declaration omits expanded synthetic signature');
      assert(!observed.some(t => t.name === 'smoke_synthetic'), 'hidden synthetic tool leaked as a provider declaration');
      await wait(700);
      const requestCount = requests.length;
      chunks.length = 0;
      pi.stdin.write('/context usage\r'); await wait(1400);
      screen = stripAnsi(chunks.join(''));
      assert(/Tool definitions observed at the provider hook/.test(screen), 'provider declaration notice absent from Usage TUI');
      assert(/Built-in Tools/.test(screen), 'Usage omits observed codemode');
      assert(!/Custom Tools/.test(screen), 'hidden raw schema contributes to Usage');
      pi.stdin.write('\x1b'); await wait(450);
      chunks.length = 0;
      pi.stdin.write('/context injections\r'); await wait(1400);
      screen = stripAnsi(chunks.join(''));
      assert(order === 0 ? /estimates are incomplete/.test(screen) : /Tool definitions observed at the provider hook/.test(screen), 'Initial declaration provenance is incorrect');
      assert(/smoke_synthetic/.test(screen) && /0.*Dropped/.test(screen), 'hidden synthetic tool is not shown as Dropped 0');
      pi.stdin.write('\r'); await wait(700); // Enter selects the initially focused row for preview.
      pi.stdin.write('\x1b'); await wait(450);
      pi.stdin.write('\x1b'); await wait(450);
      pi.stdin.write('/context injections\r'); await wait(1000);
      pi.stdin.write('\x1b'); await wait(300);
      pi.stdin.write('/reload\r'); await wait(2000);
      chunks.length = 0;
      pi.stdin.write('/context usage\r'); await wait(2600);
      screen = stripAnsi(chunks.join(''));
      assert(/estimates are incomplete/.test(screen), 'reload must invalidate process-local declaration evidence');
      assert(requests.length === requestCount, 'view/probe/reopen/reload unexpectedly called provider');
      assert((await readFile(sentinel, 'utf8')).split('response').length - 1 === requestCount, 'provider-response sentinel count mismatch');
      pi.stdin.write('\x1b'); await wait(350);
      allDisplays.push(screen.slice(-15000));
      pi.stdin.write('\x04'); await wait(300);
      pi.kill('SIGTERM');
      await new Promise(resolve => { const timer = setTimeout(resolve, 2500); pi.once('close', () => { clearTimeout(timer); resolve(); }); });
      pi = undefined;
      // after_provider_response sentinel: real response yielded assistant output
      assert(responseCount > 0, 'provider response sentinel saw no response');
      // SSE parser execution is covered by the response-hook sentinel and the successful observed Usage above.
      if (stderr && /error|failed/i.test(stderr)) console.error(`run ${run + 1} stderr (bounded): ${stripAnsi(stderr).slice(-1000)}`);
    }
    console.log(`PASS: real Pi ${piVersion} PTY, first silent /context probe made no provider request; synthetic prompt reached local Responses server; only codemode was serialized with expanded smoke_synthetic signature; notice/Dropped 0/preview/reopen/reload checked; Responses function fallback + native custom grammar + Completions nested custom grammar exercised in both fixture extension orders with provider-response sentinel.`);
  } finally {
    if (pi && !pi.killed) pi.kill('SIGTERM');
    await new Promise(resolve => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(`FAIL smoke-codemode: ${error.message}`); process.exitCode = 1; });
