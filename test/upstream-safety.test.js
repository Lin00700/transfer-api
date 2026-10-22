import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

test('disabled and blocked upstreams fail closed across all public routes', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected network request'); };
  try {
    const upstreams = [undefined, '', 'https://unlimited.surf', 'https://UNLIMITED.SURF.', 'https://api.unlimited.surf', 'https://a.b.unlimited.surf./', 'https://%75nlimited.surf', 'http://trusted.example', 'https://user:password@trusted.example', 'https://trusted.example/?redirect=1', 'not a URL'];
    const routes = ['/', '/health', '/api/chat', '/api/models', '/v1/models', '/v1/chat/completions', '/v1/responses', '/v1/messages', '/anthropic/v1/messages', '/v1/search', '/v1/merge', '/v1/files', '/v1/attachments/extract', '/v1/key', '/v1/usage', '/v1/setup', '/v1/codex', '/v1/mcp'];
    for (const upstream of upstreams) {
      for (const path of routes) {
        const response = await worker.fetch(new Request(`https://worker.example${path}`), { UPSTREAM_BASE_URL: upstream });
        assert.equal(response.status, 503, `${upstream}: ${path}`);
        assert.equal((await response.json()).error.code, 'upstream_disabled');
      }
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('trusted upstream is explicit and raw proxy never follows redirects', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), redirect: init.redirect });
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const env = { UPSTREAM_BASE_URL: 'https://trusted.example', API_KEY: 'test-only' };
    const response = await worker.fetch(new Request('https://worker.example/api/models'), env);
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [{ url: 'https://trusted.example/api/models', redirect: 'manual' }]);
    calls.length = 0;
    const models = await worker.fetch(new Request('https://worker.example/v1/models'), env);
    assert.equal(models.status, 200);
    assert.equal(calls[0].redirect, 'error');
  } finally { globalThis.fetch = originalFetch; }
});

test('CORS preflight remains network-free while upstream is disabled', async () => {
  const response = await worker.fetch(new Request('https://worker.example/api/chat', { method: 'OPTIONS' }), {});
  assert.equal(response.status, 204);
});
