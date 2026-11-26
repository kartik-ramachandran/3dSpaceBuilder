// Backend route that lets the locally served page use Claude through the Anthropic API.
//   GET  /api/health  -> { claude: true|false }  (whether credentials are configured)
//   POST /api/layout  { prompt: "..." } -> layout spec JSON, or { error: code } with a 4xx/5xx status
// The error codes match the ones the page already handles for the artifact `sample` capability.
import Anthropic from '@anthropic-ai/sdk';
import { claudePrompt } from '../src/spec/claude-prompt.js';
import { referenceContent } from './reference-content.mjs';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const hasCredentials = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);

let client = null;
const getClient = () => (client ??= new Anthropic());

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req, limit = 29 * 1024 * 1024) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('too large'), { status: 413 }); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

// Pull the first complete JSON object out of the reply text.
function extractJson(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in reply');
  return JSON.parse(text.slice(start, end + 1));
}

async function layout(prompt, references, signal) {
  const content = await referenceContent(references);
  content.push({ type: 'text', text: claudePrompt(prompt, references.length) });
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'low' },  // a single JSON layout; low effort keeps it quick
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',             // if a safety classifier declines, the API retries on a fallback model
    messages: [{ role: 'user', content }],
  }, { signal });
  if (response.stop_reason === 'refusal') throw Object.assign(new Error('refused'), { code: 'refused' });
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return extractJson(text);
}

/** Returns true if it handled the request. */
export async function handleApi(req, res, pathname) {
  if (!pathname.startsWith('/api/')) return false;

  if (pathname === '/api/health' && req.method === 'GET') { send(res, 200, { claude: hasCredentials(), references: true, model: MODEL }); return true; }

  if (pathname === '/api/layout' && req.method === 'POST') {
    if (!hasCredentials()) { send(res, 503, { error: 'not_granted', message: 'Set ANTHROPIC_API_KEY (e.g. in .env) and restart the server.' }); return true; }
    let body;
    try { body = await readJson(req); } catch (e) { send(res, e.status || 400, { error: 'bad_request', message: e.status === 413 ? 'The reference files are too large.' : 'Invalid request.' }); return true; }
    if (!body || typeof body !== 'object') { send(res, 400, { error: 'bad_request' }); return true; }
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const references = body.references ?? [];
    if (!Array.isArray(references) || (!prompt && !references.length) || prompt.length > 4000) { send(res, 400, { error: 'bad_request', message: 'Provide a description (up to 4,000 characters) or reference files.' }); return true; }

    const ctl = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ctl.abort(); });  // browser pressed Stop
    try {
      send(res, 200, await layout(prompt || 'Build a space using the attached references and their instructions.', references, ctl.signal));
    } catch (err) {
      if (ctl.signal.aborted) return true;
      if (err.code === 'bad_reference') send(res, err.status || 400, { error: err.code, message: err.message });
      else if (err.code === 'refused') send(res, 422, { error: 'refused' });
      else if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) { console.error('[api] auth:', err.message); send(res, 401, { error: 'session_expired', message: 'The Anthropic API key was rejected.' }); }
      else if (err instanceof Anthropic.RateLimitError) send(res, 429, { error: 'rate_limited' });
      else if (err instanceof Anthropic.APIError) { console.error(`[api] ${err.status}:`, err.message); send(res, 502, { error: 'upstream', message: err.message }); }
      else { console.error('[api]', err.message); send(res, 502, { error: 'bad_reply', message: err.message }); }
    }
    return true;
  }

  // Compose from a picture: { instructions, image: { name, mediaType, data } } -> { summary, items }
  if (pathname === '/api/compose' && req.method === 'POST') {
    if (!hasCredentials()) { send(res, 503, { error: 'not_granted', message: 'Set ANTHROPIC_API_KEY (e.g. in .env) and restart the server.' }); return true; }
    let body;
    try { body = await readJson(req); } catch (e) { send(res, e.status || 400, { error: 'bad_request', message: 'The image is too large.' }); return true; }
    const instructions = typeof body?.instructions === 'string' ? body.instructions.slice(0, 20000) : '';
    if (!instructions || !body.image) { send(res, 400, { error: 'bad_request', message: 'Send an image.' }); return true; }
    const ctl = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ctl.abort(); });
    try {
      const content = await referenceContent([body.image]);
      content.push({ type: 'text', text: instructions });
      const response = await getClient().beta.messages.create({
        model: MODEL, max_tokens: 16000, output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        messages: [{ role: 'user', content }],
      }, { signal: ctl.signal });
      if (response.stop_reason === 'refusal') { send(res, 422, { error: 'refused' }); return true; }
      send(res, 200, extractJson(response.content.filter((b) => b.type === 'text').map((b) => b.text).join('')));
    } catch (err) {
      if (ctl.signal.aborted) return true;
      if (err.code === 'bad_reference') send(res, 400, { error: err.code, message: err.message });
      else if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) send(res, 401, { error: 'session_expired', message: 'The Anthropic API key was rejected.' });
      else if (err instanceof Anthropic.RateLimitError) send(res, 429, { error: 'rate_limited' });
      else { console.error('[api compose]', err.message); send(res, 502, { error: 'bad_reply', message: err.message }); }
    }
    return true;
  }

  send(res, 404, { error: 'not_found' });
  return true;
}
