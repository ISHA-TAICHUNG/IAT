import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { createSnapshotReader, PublicationError, reportPublicationFailure,
  snapshotFreshness, reportPublishedSnapshotAge } from '../tools/snapshot-publication.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = data => new Response(JSON.stringify(data), { status: 200 });
function reader(fetchImpl, extra = {}) {
  const logs = [];
  const delays = [];
  return { logs, delays, api: createSnapshotReader({ gasUrl: 'https://source.invalid/exec',
    token: 'synthetic_secret', clientId: 'c_synthetic_identity', fetchImpl,
    log: line => logs.push(line), sleep: async ms => delays.push(ms), ...extra }) };
}

test('source query contract, same identity on retry, and credential-free diagnostics', async () => {
  const requests = [];
  const { api, logs, delays } = reader(async (url, options) => {
    requests.push(new URL(url));
    assert.equal(options.method, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    if (requests.length === 1) throw new TypeError('https://private.invalid/?token=synthetic_secret');
    return json([{ id: 1 }]);
  });
  assert.deepEqual(await api.readGas('questions', { cat: '職護', full: '1', token: 'override' }), [{ id: 1 }]);
  assert.equal(requests.length, 2);
  for (const url of requests) {
    assert.equal(url.searchParams.get('clientId'), 'c_synthetic_identity');
    assert.equal(url.searchParams.get('token'), 'synthetic_secret');
    assert.equal(url.searchParams.get('cat'), '職護');
    assert.equal(url.searchParams.get('full'), '1');
  }
  assert.deepEqual(delays, [3000]);
  assert.equal(logs.some(line => /synthetic_secret|private.invalid/.test(line)), false);
  const failure = logs.map(JSON.parse).find(item => item.event === 'snapshot_request_failure');
  assert.equal(failure.cat, '職護');
  assert.equal(failure.code, 'NETWORK_ERROR');
  assert.equal(failure.willRetry, true);
});

for (const status of [408, 500, 502, 503, 504]) {
  test('bounded transient HTTP retry: ' + status, async () => {
    let calls = 0;
    const { api, delays } = reader(async () => { calls++; return new Response('', { status }); });
    await assert.rejects(api.readGas('categories'), { code: 'HTTP_' + status, retryable: true });
    assert.equal(calls, 3);
    assert.deepEqual(delays, [3000, 6000]);
  });
}

for (const status of [400, 401, 403, 404, 429]) {
  test('permanent HTTP rejection is not retried: ' + status, async () => {
    let calls = 0;
    const { api, delays } = reader(async () => { calls++; return new Response('', { status }); });
    await assert.rejects(api.readGas('categories'), { code: 'HTTP_' + status, retryable: false });
    assert.equal(calls, 1);
    assert.deepEqual(delays, []);
  });
}

for (const name of ['TimeoutError', 'AbortError']) {
  test('deadline includes body reading: ' + name, async () => {
    let calls = 0;
    const { api } = reader(async () => {
      calls++;
      return { ok: true, status: 200, json: async () => { throw new DOMException('private body', name); } };
    });
    await assert.rejects(api.readGas('bankRevisions'), { code: 'REQUEST_TIMEOUT', retryable: true });
    assert.equal(calls, 3);
  });
}

test('API error, malformed JSON, and unknown transport failures stop safely', async () => {
  for (const [response, code] of [
    [json({ error: 'rate limit synthetic_secret' }), 'API_REJECTED'],
    [new Response('not json'), 'INVALID_JSON'],
    [null, 'RESPONSE_READ_FAILED']
  ]) {
    let calls = 0;
    const { api, logs } = reader(async () => { calls++; if (!response) throw new Error('private'); return response; });
    await assert.rejects(api.readGas('categories'), { code, retryable: false });
    assert.equal(calls, 1);
    assert.equal(logs.join('').includes('synthetic_secret'), false);
  }
});

test('actual deadline aborts a stalled body instead of waiting forever', async () => {
  const { api } = reader(async (url, options) => ({
    ok: true, status: 200,
    json: () => new Promise((resolveBody, rejectBody) => {
      const keepAlive = setTimeout(() => rejectBody(new Error('deadline did not abort')), 1000);
      options.signal.addEventListener('abort', () => {
        clearTimeout(keepAlive);
        rejectBody(options.signal.reason);
      }, { once: true });
    })
  }), { timeoutMs: 5, maxAttempts: 1 });
  await assert.rejects(api.readGas('categories'), { code: 'REQUEST_TIMEOUT', retryable: true });
});

test('snapshot helper cannot call admin endpoints and rejects unbounded retry budgets', () => {
  const { api } = reader(() => assert.fail('must not fetch'));
  assert.throws(() => api.readGas('adminReplaceJson'), { code: 'UNSUPPORTED_SNAPSHOT_ACTION' });
  for (const maxAttempts of [0, 4, NaN, 1.5]) {
    assert.throws(() => reader(() => assert.fail(), { maxAttempts }), { code: 'INVALID_RETRY_BUDGET' });
  }
});

test('public bank failures receive the same bounded transport policy', async () => {
  let calls = 0;
  const { api, logs } = reader(async () => {
    calls++;
    if (calls === 1) throw new DOMException('private URL', 'TimeoutError');
    return new Response('synthetic bank');
  });
  assert.equal((await api.readPublic('https://public.invalid/bank.json', { format: 'bytes', cat: 'fixture' })).toString(), 'synthetic bank');
  assert.equal(calls, 2);
  assert.equal(logs.map(JSON.parse).at(-1).phase, 'public');
});

test('12h warning and 24h expiry preserve consumer freshness boundaries', () => {
  const now = Date.parse('2026-10-11T00:00:00Z');
  const manifest = age => ({ schema: 1, categories: [{}], generatedAt: new Date(now - age).toISOString() });
  for (const [hours, state] of [[0, 'fresh'], [11.999, 'fresh'], [12, 'aging'], [23.999, 'aging'], [24, 'expired']]) {
    assert.equal(snapshotFreshness(manifest(hours * 3600000), now).state, state);
  }
  assert.equal(snapshotFreshness(manifest(-60000), now).state, 'fresh');
  for (const value of [manifest(-60001), { schema: 1, categories: [{}], generatedAt: 'invalid' }, {}]) {
    assert.throws(() => snapshotFreshness(value, now), { code: 'INVALID_PUBLIC_MANIFEST' });
  }
});

test('old or missing public snapshot is diagnostic, not a rebuild blocker', async () => {
  const now = Date.parse('2026-10-11T00:00:00Z');
  const warnings = [];
  for (const fetchImpl of [async () => json({ schema: 1, categories: [{}], generatedAt: '2026-10-09T00:00:00Z' }),
    async () => { throw new Error('synthetic_secret'); }]) {
    const logs = [];
    const result = await reportPublishedSnapshotAge('https://public.invalid/', {
      fetchImpl, now: () => now, log: line => logs.push(line), warn: line => warnings.push(line), summaryPath: ''
    });
    assert.ok(['expired', 'unavailable'].includes(result.state));
    assert.equal(logs.join('').includes('synthetic_secret'), false);
  }
  assert.equal(warnings.length, 2);
});

test('step outputs permit rebuilding only classified transient failures', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'iat-failure-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const path = join(temp, 'outputs');
  const logs = [];
  for (const [error, retry] of [[new PublicationError('SOURCE_CHANGED', true), true],
    [new PublicationError('INVALID_BANK'), false], [new TypeError('synthetic_secret'), false]]) {
    const result = await reportPublicationFailure(error, { outputPath: path, log: line => logs.push(line) });
    assert.equal(result.rebuildRequired, retry);
  }
  assert.equal(await readFile(path, 'utf8'), 'rebuild_required=true\nrebuild_required=false\nrebuild_required=false\n');
  assert.equal(logs.join('').includes('synthetic_secret'), false);
});

test('workflow retry is bounded, fail-closed and includes build failures', async () => {
  const yaml = await readFile(join(root, '.github/workflows/pages.yml'), 'utf8');
  assert.match(yaml, /steps\.build\.outputs\.rebuild_required == 'true'/);
  assert.doesNotMatch(yaml, /continue-on-error/);
  const script = yaml.split('script: |\n')[1].split('\n').map(line => line.slice(12)).join('\n');
  for (const depth of ['0', '1', '2', '-1', 'NaN', '0.5', 'Infinity']) {
    const calls = [];
    const context = { process: { env: { RETRY_DEPTH: depth } }, context: { repo: { owner: 'fixture', repo: 'fixture' } },
      github: { rest: { actions: { createWorkflowDispatch: async value => calls.push(value) } } } };
    const result = vm.runInNewContext('(async () => {' + script + '})()', context);
    if (depth === '0' || depth === '1') {
      await result;
      assert.equal(calls.length, 1);
      assert.equal(calls[0].inputs.retryDepth, String(Number(depth) + 1));
    } else {
      await assert.rejects(result);
      assert.equal(calls.length, 0);
    }
  }
});

const fixtureCategory = { id: 'fixture', name: 'Synthetic', group: 'fixture', total: 2 };
const fixtureQuestions = [
  { id: 1, q: 'Synthetic single', options: ['A', 'B'], answer: 0, internalNote: 'private fixture' },
  { id: 2, q: 'Synthetic multi', options: ['A', 'B'], answer: [0, 1], multi: true }
];
const publicQuestions = fixtureQuestions.map(({ internalNote, ...question }) => question);
const content = JSON.stringify(publicQuestions);
const hash = createHash('sha256').update(content).digest('hex');
const fixtureManifest = { schema: 1, generatedAt: new Date().toISOString(), categories: [fixtureCategory],
  banks: { fixture: { file: hash + '.json', sha256: hash, total: 2, sourceUpdatedAt: 'fixture-v1' } } };

async function runFixture(t, script, mode, extraArgs = []) {
  const temp = await mkdtemp(join(tmpdir(), 'iat-publication-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const site = join(temp, 'site');
  if (script === 'verify_public_snapshot.mjs') {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(site, 'banks'), { recursive: true });
    await writeFile(join(site, 'banks/manifest.json'), JSON.stringify(fixtureManifest));
  }
  const preload = 'const category=' + JSON.stringify(fixtureCategory) + ';const questions=' + JSON.stringify(fixtureQuestions) +
    ';const manifest=' + JSON.stringify(fixtureManifest) + ';const mode=' + JSON.stringify(mode) + `;
    let revisionCalls = 0;
    globalThis.fetch = async (input, options) => {
      if (options.method && options.method !== 'GET') throw new Error('unexpected write');
      const url = new URL(input);
      const action = url.searchParams.get('action');
      const reply = data => new Response(JSON.stringify(data));
      if (action === 'categories') return reply([category]);
      if (action === 'bankRevisions') {
        revisionCalls++;
        if (mode === 'nullRevision') return reply(null);
        if (mode === 'missingRevision') return reply({ revisions: { unrelated: 'fixture-v1' } });
        return reply({ revisions: { fixture: mode === 'sourceChanged' && revisionCalls > 1 ? 'fixture-v2' : 'fixture-v1' } });
      }
      if (action === 'questions') return reply(mode === 'invalidBank' ? questions.slice(0, 1) : questions);
      if (action) throw new Error('unexpected action');
      if (url.pathname.endsWith('/manifest.json')) return reply(manifest);
      return reply(mode === 'checksumMismatch' ? [] : questions.map(({ internalNote, ...question }) => question));
    };`;
  const result = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(preload),
    join(root, 'tools', script), site, ...extraArgs], {
    cwd: root, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, GITHUB_OUTPUT: join(temp, 'outputs'), GITHUB_STEP_SUMMARY: join(temp, 'summary') }
  });
  assert.equal(result.error, undefined);
  return { ...result, temp, site };
}

test('actual builder preserves hashes, full counts, projection and publication allowlist', async t => {
  const result = await runFixture(t, 'build_public_snapshot.mjs', 'valid');
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(await readFile(join(result.site, 'banks/manifest.json'), 'utf8'));
  assert.equal(manifest.banks.fixture.sha256, hash);
  assert.equal(manifest.banks.fixture.total, 2);
  assert.equal(await readFile(join(result.site, 'banks', hash + '.json'), 'utf8'), content);
  await assert.rejects(readFile(join(result.site, 'tools/snapshot-publication.mjs')));
  await assert.rejects(readFile(join(result.site, 'AGENTS.md')));
  assert.equal(await readFile(join(result.site, 'js/config.js'), 'utf8'), await readFile(join(root, 'js/config.js'), 'utf8'));
});

for (const [mode, code, rebuild] of [['invalidBank', 'INVALID_BANK', false], ['sourceChanged', 'SOURCE_CHANGED', true],
  ['missingRevision', 'MISSING_SOURCE_REVISIONS', false], ['nullRevision', 'MISSING_SOURCE_REVISIONS', false]]) {
  test('actual builder fails without manifest: ' + mode, async t => {
    const result = await runFixture(t, 'build_public_snapshot.mjs', mode);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(code));
    assert.equal(await readFile(join(result.temp, 'outputs'), 'utf8'), 'rebuild_required=' + rebuild + '\n');
    await assert.rejects(readFile(join(result.site, 'banks/manifest.json')));
  });
}

test('actual verifier checks both source revisions and all public hashes', async t => {
  for (const [mode, status, code] of [['valid', 0, ''], ['checksumMismatch', 1, 'PUBLIC_BANK_CHECKSUM_MISMATCH'],
    ['sourceChanged', 1, 'SOURCE_CHANGED']]) {
    const result = await runFixture(t, 'verify_public_snapshot.mjs', mode, ['--public']);
    assert.equal(result.status, status, result.stderr);
    if (code) assert.match(result.stderr, new RegExp(code));
    else assert.match(result.stdout, /verification: PASS/);
  }
});
