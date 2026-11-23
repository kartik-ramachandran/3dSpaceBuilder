import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { referenceContent } from '../scripts/reference-content.mjs';
import { referenceFixtures } from './reference-fixtures.mjs';
import { normalize, PRESETS } from '../src/spec/schema.js';
import { claudePrompt } from '../src/spec/claude-prompt.js';

const files = (await referenceFixtures()).map(({ name, mediaType, buffer }) => ({ name, mediaType, data: buffer.toString('base64') }));
const content = await referenceContent(files);
assert.equal(content.filter((b) => b.type === 'image').length, 2, 'standalone and embedded Word images survive extraction');
assert(content.some((b) => b.text?.includes('two-floor office with oak tables and blue chairs')), 'Word prompts survive extraction');
assert.equal(content.find((b) => b.type === 'document').source.data, files[1].data, 'PDF is sent intact for text and visual analysis');
await assert.rejects(referenceContent([...files, ...files, files[0]]), /up to 6/);
await assert.rejects(referenceContent([{ ...files[1], data: Buffer.from('not a PDF').toString('base64') }]), /valid PDF/);
await assert.rejects(referenceContent([{ ...files[2], data: files[0].data }]), /Word document/);
await assert.rejects(referenceContent([{ ...files[0], data: 'not_base64!' }]), /invalid/);
assert.match(claudePrompt('', 3), /written requirements in PDFs and Word documents/);
assert.deepEqual(normalize({ ...PRESETS.office, design: { woodColor: '#a17243', upholsteryColor: 'bad', floorColor: '#aabbcc' } }).design, { woodColor: '#a17243', floorColor: '#aabbcc' });

let captured, calls = 0;
const upstream = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  captured = JSON.parse(Buffer.concat(chunks)); calls++;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ id: 'test', type: 'message', role: 'assistant', model: 'test', content: [{ type: 'text', text: JSON.stringify(PRESETS.office) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
// All API calls in this test go to this local fake provider, never to Anthropic.
process.env.ANTHROPIC_API_KEY = 'test-only'; process.env.ANTHROPIC_AUTH_TOKEN = ''; process.env.ANTHROPIC_PROFILE = '';
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
const { startServer } = await import('../scripts/serve.mjs');
const server = await startServer(0);
const endpoint = `http://127.0.0.1:${server.address().port}`;
try {
  assert.equal((await (await fetch(`${endpoint}/api/health`)).json()).references, true);
  const post = (body) => fetch(`${endpoint}/api/layout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let response = await post({ prompt: '', references: files });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).kind, 'office');
  assert.equal(captured.messages[0].content.filter((b) => b.type === 'image').length, 2);
  assert(captured.messages[0].content.some((b) => b.type === 'document'));
  response = await post({ prompt: 'Build it', references: [{ ...files[0], data: 'broken' }] });
  assert.equal(response.status, 400); assert.equal(calls, 1, 'invalid files never reach the provider');
  response = await post({ prompt: 'An office' }); assert.equal(response.status, 200, 'text-only requests still work');
  console.log('Reference tests passed: DOCX text/images, intact PDF, image validation, color normalization, and end-to-end API payloads (mock provider).');
} finally { server.closeAllConnections(); server.close(); upstream.closeAllConnections(); upstream.close(); }
