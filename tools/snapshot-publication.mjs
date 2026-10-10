import { appendFile } from 'node:fs/promises';

const READ_ACTIONS = new Set(['categories', 'questions', 'bankRevisions']);
const TRANSIENT_HTTP = new Set([408, 500, 502, 503, 504]);
const HOUR_MS = 60 * 60 * 1000;

export class PublicationError extends Error {
  constructor(code, retryable = false) {
    super(code);
    this.name = 'PublicationError';
    this.code = code;
    this.retryable = retryable;
  }
}

// 只在 fetch／讀取回應的範圍判斷網路錯誤，不把一般程式錯誤當成可重試。
function transportError(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return new PublicationError('REQUEST_TIMEOUT', true);
  }
  if (error instanceof TypeError) return new PublicationError('NETWORK_ERROR', true);
  if (error instanceof SyntaxError) return new PublicationError('INVALID_JSON');
  return new PublicationError('RESPONSE_READ_FAILED');
}

export function createSnapshotReader({
  gasUrl, token, clientId, fetchImpl = globalThis.fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  log = console.log, now = Date.now, timeoutMs = 60000, maxAttempts = 3
}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new PublicationError('INVALID_RETRY_BUDGET');
  }
  async function read(url, metadata, format, apiRequest, deadline) {
    const cat = /^[\w\u3400-\u9fff]{1,100}$/.test(metadata.cat || '') ? metadata.cat : undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const started = now();
      const context = { phase: metadata.phase, action: metadata.action, cat, attempt, maxAttempts,
        timeoutMs: deadline };
      log(JSON.stringify({ event: 'snapshot_request_start', ...context }));
      let status;
      try {
        let response;
        try {
          response = await fetchImpl(url, { signal: AbortSignal.timeout(deadline), cache: 'no-store' });
        } catch (error) {
          throw transportError(error);
        }
        status = response.status;
        if (!response.ok) throw new PublicationError('HTTP_' + status, TRANSIENT_HTTP.has(status));
        let data;
        try {
          data = format === 'bytes' ? Buffer.from(await response.arrayBuffer()) : await response.json();
        } catch (error) {
          throw transportError(error);
        }
        if (apiRequest && data?.error) throw new PublicationError('API_REJECTED');
        log(JSON.stringify({ event: 'snapshot_request_success', ...context, status,
          elapsedMs: Math.max(0, now() - started) }));
        return data;
      } catch (error) {
        const failure = error instanceof PublicationError ? error : new PublicationError('UNEXPECTED_PUBLICATION_FAILURE');
        const willRetry = failure.retryable && attempt < maxAttempts;
        log(JSON.stringify({ event: 'snapshot_request_failure', ...context, status,
          elapsedMs: Math.max(0, now() - started), code: failure.code, willRetry }));
        if (!willRetry) throw failure;
        await sleep(3000 * attempt);
      }
    }
  }
  return {
    readGas(action, params = {}) {
      if (!READ_ACTIONS.has(action)) throw new PublicationError('UNSUPPORTED_SNAPSHOT_ACTION');
      const url = gasUrl + '?' + new URLSearchParams({ ...params, action, token, clientId });
      return read(url, { phase: 'source', action, cat: params.cat }, 'json', true, timeoutMs);
    },
    readPublic(url, { cat, format = 'json', deadline = 30000 } = {}) {
      return read(url, { phase: 'public', action: format === 'bytes' ? 'bank' : 'manifest', cat },
        format, false, deadline);
    }
  };
}

export function snapshotFreshness(manifest, now = Date.now()) {
  const generated = typeof manifest?.generatedAt === 'string' ? Date.parse(manifest.generatedAt) : NaN;
  if (manifest?.schema !== 1 || !Array.isArray(manifest.categories) || !manifest.categories.length ||
      !Number.isFinite(generated) || !Number.isFinite(now) || generated - now > 60000) {
    throw new PublicationError('INVALID_PUBLIC_MANIFEST');
  }
  const age = Math.max(0, now - generated);
  return { generatedAt: new Date(generated).toISOString(), ageHours: Number((age / HOUR_MS).toFixed(2)),
    state: age >= 24 * HOUR_MS ? 'expired' : age >= 12 * HOUR_MS ? 'aging' : 'fresh' };
}

export async function reportPublishedSnapshotAge(baseUrl, {
  fetchImpl = globalThis.fetch, now = Date.now, log = console.log, warn = console.warn,
  summaryPath = process.env.GITHUB_STEP_SUMMARY
} = {}) {
  let result;
  try {
    const response = await fetchImpl(baseUrl + 'manifest.json?age=' + now(), {
      signal: AbortSignal.timeout(8000), cache: 'no-store'
    });
    if (!response.ok) throw new PublicationError('PUBLIC_MANIFEST_UNAVAILABLE');
    result = snapshotFreshness(await response.json(), now());
  } catch (error) {
    result = { state: 'unavailable', code: error instanceof PublicationError ? error.code : 'PUBLIC_MANIFEST_UNAVAILABLE' };
  }
  log(JSON.stringify({ event: 'published_snapshot_freshness', ...result }));
  if (result.state !== 'fresh') {
    warn('::warning::Public snapshot state=' + result.state +
      (result.ageHours === undefined ? '' : ', ageHours=' + result.ageHours) + '; warning at 12h, expiry at 24h');
  }
  if (summaryPath) {
    await appendFile(summaryPath, '### Existing public snapshot\n\nState: ' + result.state +
      (result.ageHours === undefined ? '' : '; age: ' + result.ageHours + ' hours; generated: ' + result.generatedAt) +
      '\n\nWarning threshold: 12h. Consumer expiry: 24h (unchanged).\n');
  }
  return result;
}

export async function reportPublicationFailure(error, {
  outputPath = process.env.GITHUB_OUTPUT, log = console.error
} = {}) {
  const known = error instanceof PublicationError && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code);
  const code = known ? error.code : 'UNEXPECTED_PUBLICATION_FAILURE';
  const rebuildRequired = known && error.retryable === true;
  log(JSON.stringify({ event: 'snapshot_publication_failure', code, rebuildRequired }));
  if (outputPath) await appendFile(outputPath, 'rebuild_required=' + rebuildRequired + '\n');
  return { code, rebuildRequired };
}
