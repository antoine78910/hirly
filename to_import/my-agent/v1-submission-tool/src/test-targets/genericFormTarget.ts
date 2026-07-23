/**
 * A safe, local stand-in for "some company's plain HTML job application form."
 * Used to prove the generic web-form-fill adapter against a real HTTP+HTML
 * round trip without ever touching a real company's real form.
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

interface Submission {
  id: string;
  fields: Record<string, string>;
  submittedAt: string;
}

const submissions = new Map<string, Submission>();

const FORM_HTML = `<!doctype html>
<html><body>
<h1>Apply — Generic Test Co</h1>
<form action="/apply" method="POST">
  <label for="full_name">Full Name</label>
  <input type="text" id="full_name" name="full_name" />
  <label for="email">Email</label>
  <input type="email" id="email" name="email" />
  <label for="portfolio_url">Portfolio URL</label>
  <input type="text" id="portfolio_url" name="portfolio_url" />
  <label for="cover_note">Cover Note</label>
  <textarea id="cover_note" name="cover_note"></textarea>
  <button type="submit">Submit Application</button>
</form>
</body></html>`;

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export function createGenericFormServer() {
  return createServer(async (req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/apply')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(FORM_HTML);
      return;
    }

    if (req.method === 'POST' && req.url === '/apply') {
      const raw = await readBody(req);
      const fields = Object.fromEntries(new URLSearchParams(raw));
      const id = `form-app-${randomUUID()}`;
      submissions.set(id, { id, fields, submittedAt: new Date().toISOString() });
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<html><body><p id="confirmation">Application received. Reference: ${id}</p></body></html>`);
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/status/')) {
      const id = req.url.split('/').pop();
      const record = id ? submissions.get(id) : undefined;
      res.writeHead(record ? 200 : 404, { 'content-type': 'application/json' });
      res.end(JSON.stringify(record ?? { error: 'not_found' }));
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.GENERIC_FORM_PORT ?? 4792);
  createGenericFormServer().listen(port, () => console.log(`generic-form-target on :${port}`));
}
