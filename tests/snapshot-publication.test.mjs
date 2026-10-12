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
  snapshotFreshness, reportPublishedSnapshotAge, waitForPublishedManifest } from '../tools/snapshot-publication.mjs';

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

function publicationWait(extra = {}) {
  let clock = Date.now();
  const delays = [];
  const logs = [];
  const sourceChecks = [];
  const options = { expected: fixtureManifest, readManifest: async () => fixtureManifest,
    checkSource: async () => sourceChecks.push(clock), now: () => clock,
    sleep: async ms => { delays.push(ms); clock += ms; }, log: line => logs.push(line),
    timeoutMs: 30, intervalMs: 10, ...extra };
  return { options, delays, logs, sourceChecks };
}

test('公開端延遲時等待同一索引到位，期間再次核對來源', async () => {
  let reads = 0;
  const previous = { ...fixtureManifest, generatedAt: new Date(Date.now() - 60000).toISOString() };
  const state = publicationWait({ readManifest: async deadline => {
    assert.ok(deadline > 0 && deadline <= 30);
    return ++reads < 3 ? previous : fixtureManifest;
  } });
  assert.deepEqual(await waitForPublishedManifest(state.options), fixtureManifest);
  assert.equal(reads, 3);
  assert.deepEqual(state.delays, [10, 10]);
  assert.equal(state.sourceChecks.length, 2);
  assert.equal(JSON.parse(state.logs.at(-1)).event, 'published_manifest_ready');
});

test('JSON 物件鍵順序不影響比較，陣列順序與內容仍必須相同', async () => {
  const reordered = { banks: fixtureManifest.banks, categories: fixtureManifest.categories,
    generatedAt: fixtureManifest.generatedAt, schema: 1 };
  const state = publicationWait({ readManifest: async () => reordered });
  await waitForPublishedManifest(state.options);
  assert.deepEqual(state.delays, []);
  for (const manifest of [{ ...fixtureManifest, categories: [] },
    { ...fixtureManifest, banks: { fixture: { ...fixtureManifest.banks.fixture, total: 1 } } }]) {
    const invalid = publicationWait({ readManifest: async () => manifest });
    await assert.rejects(waitForPublishedManifest(invalid.options));
  }
});

test('公開索引持續不符時期限到就停止，不再派整個工作重建', async () => {
  const state = publicationWait({ readManifest: async () => ({ ...fixtureManifest,
    generatedAt: new Date(Date.now() - 60000).toISOString() }) });
  await assert.rejects(waitForPublishedManifest(state.options), { code: 'PUBLIC_MANIFEST_MISMATCH', retryable: false });
  assert.deepEqual(state.delays, [10, 10, 10]);
  assert.equal(state.sourceChecks.length, 3);
});

test('等待期間來源變更或讀取失敗會立刻中止', async () => {
  for (const error of [new PublicationError('SOURCE_CHANGED', true), new PublicationError('HTTP_404')]) {
    const state = publicationWait({ readManifest: async () => ({ ...fixtureManifest,
      generatedAt: new Date(Date.now() - 60000).toISOString() }), checkSource: async () => { throw error; } });
    await assert.rejects(waitForPublishedManifest(state.options), { code: error.code });
    assert.deepEqual(state.delays, []);
  }
});

test('剛部署的公開路徑暫時 404 或逾時可等待，登入與格式錯誤立即停止', async () => {
  for (const error of [new PublicationError('HTTP_404'), new PublicationError('REQUEST_TIMEOUT', true)]) {
    let reads = 0;
    const state = publicationWait({ readManifest: async () => {
      if (++reads === 1) throw error;
      return fixtureManifest;
    } });
    await waitForPublishedManifest(state.options);
    assert.deepEqual(state.delays, [10]);
  }
  for (const error of [new PublicationError('HTTP_401'), new PublicationError('HTTP_403'),
    new PublicationError('HTTP_429'), new PublicationError('INVALID_JSON'), new Error('synthetic_secret')]) {
    const state = publicationWait({ readManifest: async () => { throw error; } });
    await assert.rejects(waitForPublishedManifest(state.options));
    assert.deepEqual(state.delays, []);
    assert.equal(state.logs.join('').includes('synthetic_secret'), false);
  }
});

test('公開索引等待預算不可無限或超過十分鐘', async () => {
  for (const extra of [{ timeoutMs: 0 }, { timeoutMs: 600001 }, { timeoutMs: Infinity },
    { intervalMs: 0 }, { intervalMs: 60001 }]) {
    const state = publicationWait(extra);
    await assert.rejects(waitForPublishedManifest(state.options), { code: 'INVALID_PUBLICATION_WAIT_BUDGET' });
    assert.deepEqual(state.delays, []);
  }
  let clock = Date.now();
  const late = publicationWait({ now: () => clock, readManifest: async () => {
    clock += 31;
    return fixtureManifest;
  } });
  await assert.rejects(waitForPublishedManifest(late.options), { code: 'PUBLIC_MANIFEST_MISMATCH', retryable: false });
  assert.deepEqual(late.delays, []);
});

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
    const { createHash } = await import('node:crypto');
    const builder = ${JSON.stringify(script === 'build_public_snapshot.mjs')};
    const reuse = mode.startsWith('reuse');
    if (builder && !reuse) manifest.banks.fixture.sourceUpdatedAt = 'older-version';
    if (mode === 'reuseChangedRevision') manifest.banks.fixture.sourceUpdatedAt = 'older-version';
    if (mode === 'reuseChangedCategory') manifest.categories[0].name = 'Older name';
    if (mode === 'reuseWrongCount') manifest.banks.fixture.total = 1;
    if (mode === 'reuseExpired') manifest.generatedAt = new Date(Date.now() - 25 * 3600000).toISOString();
    if (mode === 'reuseFuture') manifest.generatedAt = new Date(Date.now() + 3600000).toISOString();
    if (mode === 'reuseWrongSchema') manifest.schema = 2;
    if (mode === 'reuseTraversal') manifest.banks.fixture.file = '../private.json';
    let publicContent = JSON.stringify(questions.map(({ internalNote, ...question }) => question));
    if (mode === 'reusePrivateField') publicContent = JSON.stringify(questions);
    if (mode === 'reuseInvalidQuestions') publicContent = JSON.stringify([{ id: 1 }]);
    if (mode === 'reuseInvalidJson') publicContent = 'invalid json';
    if (mode === 'reuseTruncated') publicContent = JSON.stringify([questions[1]]);
    if (['reusePrivateField', 'reuseInvalidQuestions', 'reuseInvalidJson', 'reuseTruncated'].includes(mode)) {
      const checksum = createHash('sha256').update(publicContent).digest('hex');
      manifest.banks.fixture.sha256 = checksum;
      manifest.banks.fixture.file = checksum + '.json';
    }
    const mixed = mode === 'reuseMixed';
    const secondCategory = { ...category, id: 'second' };
    if (mixed) {
      manifest.categories.push(secondCategory);
      manifest.banks.second = { ...manifest.banks.fixture, sourceUpdatedAt: 'older-version' };
    }
    let revisionCalls = 0;
    globalThis.fetch = async (input, options) => {
      if (options.method && options.method !== 'GET') throw new Error('unexpected write');
      const url = new URL(input);
      const action = url.searchParams.get('action');
      const reply = data => new Response(JSON.stringify(data));
      if (action === 'categories') return reply(mixed ? [category, secondCategory] : [category]);
      if (action === 'bankRevisions') {
        revisionCalls++;
        if (mode === 'nullRevision' || mode === 'reuseNullRevision') return reply(null);
        if (mode === 'missingRevision' || mode === 'reuseMissingRevision') return reply({ revisions: { unrelated: 'fixture-v1' } });
        if (mode === 'reuseAuthority404') return new Response('', { status: 404 });
        const changed = (mode === 'sourceChanged' || mode === 'reuseSourceChanged') && revisionCalls > 1;
        return reply({ revisions: { fixture: changed ? 'fixture-v2' : 'fixture-v1', ...(mixed ? { second: 'fixture-v2' } : {}) } });
      }
      if (action === 'questions') {
        console.log('FIXTURE_SOURCE_QUESTIONS:' + url.searchParams.get('cat'));
        if (mode === 'reuseCorruptSource404') return new Response('', { status: 404 });
        return reply(mode === 'invalidBank' ? questions.slice(0, 1) : questions);
      }
      if (action) throw new Error('unexpected action');
      if (url.pathname.endsWith('/manifest.json')) {
        if (mode === 'reuseMissingManifest') return new Response('', { status: 404 });
        if (mode === 'manifestOrderChanged') return reply({ banks: manifest.banks,
          generatedAt: manifest.generatedAt, categories: manifest.categories, schema: manifest.schema });
        return reply(manifest);
      }
      if (mode === 'reuseMissingBank') return new Response('', { status: 404 });
      if (['checksumMismatch', 'reuseChecksumMismatch', 'reuseCorruptSource404'].includes(mode)) return reply([]);
      return new Response(publicContent);
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
  assert.match(result.stdout, /FIXTURE_SOURCE_QUESTIONS:fixture/);
  const manifest = JSON.parse(await readFile(join(result.site, 'banks/manifest.json'), 'utf8'));
  assert.equal(manifest.banks.fixture.sha256, hash);
  assert.equal(manifest.banks.fixture.total, 2);
  assert.equal(await readFile(join(result.site, 'banks', hash + '.json'), 'utf8'), content);
  await assert.rejects(readFile(join(result.site, 'tools/snapshot-publication.mjs')));
  await assert.rejects(readFile(join(result.site, 'AGENTS.md')));
  assert.equal(await readFile(join(result.site, 'js/config.js'), 'utf8'), await readFile(join(root, 'js/config.js'), 'utf8'));
});

test('unchanged revision reuses only hash-verified public bytes without a questions request', async t => {
  const result = await runFixture(t, 'build_public_snapshot.mjs', 'reuseValid');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /FIXTURE_SOURCE_QUESTIONS/);
  assert.match(result.stdout, /"reusedBanks":1,"fetchedBanks":0/);
  assert.equal(await readFile(join(result.site, 'banks', hash + '.json'), 'utf8'), content);
});

for (const mode of ['reuseChangedRevision', 'reuseChangedCategory', 'reuseWrongCount', 'reuseExpired',
  'reuseFuture', 'reuseWrongSchema', 'reuseTraversal', 'reuseChecksumMismatch', 'reusePrivateField',
  'reuseInvalidQuestions', 'reuseInvalidJson', 'reuseTruncated', 'reuseMissingManifest', 'reuseMissingBank']) {
  test('untrusted or outdated reuse candidate requires fresh source: ' + mode, async t => {
    const result = await runFixture(t, 'build_public_snapshot.mjs', mode);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /FIXTURE_SOURCE_QUESTIONS:fixture/);
    assert.match(result.stdout, /"reusedBanks":0,"fetchedBanks":1/);
    assert.equal(await readFile(join(result.site, 'banks', hash + '.json'), 'utf8'), content);
  });
}

test('mixed bank revisions reuse unchanged category and fetch changed category', async t => {
  const result = await runFixture(t, 'build_public_snapshot.mjs', 'reuseMixed');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /FIXTURE_SOURCE_QUESTIONS:fixture/);
  assert.match(result.stdout, /FIXTURE_SOURCE_QUESTIONS:second/);
  assert.match(result.stdout, /"reusedBanks":1,"fetchedBanks":1/);
  const manifest = JSON.parse(await readFile(join(result.site, 'banks/manifest.json'), 'utf8'));
  assert.equal(manifest.banks.second.sourceUpdatedAt, 'fixture-v2');
  assert.equal(Object.keys(manifest.banks).length, 2);
});

for (const [mode, code] of [['reuseNullRevision', 'MISSING_SOURCE_REVISIONS'],
  ['reuseMissingRevision', 'MISSING_SOURCE_REVISIONS'], ['reuseAuthority404', 'HTTP_404'],
  ['reuseSourceChanged', 'SOURCE_CHANGED'], ['reuseCorruptSource404', 'HTTP_404']]) {
  test('reuse cannot bypass authority or readback gates: ' + mode, async t => {
    const result = await runFixture(t, 'build_public_snapshot.mjs', mode);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(code));
    await assert.rejects(readFile(join(result.site, 'banks/manifest.json')));
    if (mode !== 'reuseCorruptSource404') assert.doesNotMatch(result.stdout, /FIXTURE_SOURCE_QUESTIONS/);
  });
}

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
  for (const [mode, status, code] of [['valid', 0, ''], ['manifestOrderChanged', 0, ''],
    ['checksumMismatch', 1, 'PUBLIC_BANK_CHECKSUM_MISMATCH'],
    ['sourceChanged', 1, 'SOURCE_CHANGED']]) {
    const result = await runFixture(t, 'verify_public_snapshot.mjs', mode, ['--public']);
    assert.equal(result.status, status, result.stderr);
    if (code) assert.match(result.stderr, new RegExp(code));
    else assert.match(result.stdout, /verification: PASS/);
  }
});
