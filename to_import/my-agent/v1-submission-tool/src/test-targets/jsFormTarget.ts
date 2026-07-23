/**
 * A safe, local stand-in for a JavaScript-rendered ("SPA-style") job
 * application form — the class of real-world ATS UI (Greenhouse, Lever,
 * Workday) that genericWebFormAdapter.ts (plain HTML parsing) cannot fill,
 * because the form doesn't exist in the initial HTML response at all; it's
 * built by client-side JS after the page loads. Used to prove the Playwright
 * adapter against a real (if fake) JS-rendered form without ever touching a
 * real company's real ATS.
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

interface Submission {
  id: string;
  fields: Record<string, string>;
  submittedAt: string;
}

const submissions = new Map<string, Submission>();

const PAGE_HTML = `<!doctype html>
<html><head><title>JS Test Co — Apply</title></head>
<body>
<div id="root"><p>Loading application form…</p></div>
<script>
  // Simulates a React/Vue-style SPA: the form does not exist in the
  // server-rendered HTML at all, only after this script runs client-side.
  const root = document.getElementById('root');
  root.innerHTML = '';

  const h1 = document.createElement('h1');
  h1.textContent = 'Apply — JS Test Co';
  root.appendChild(h1);

  const form = document.createElement('form');
  form.id = 'app-form';

  function field(labelText, name, tag) {
    const label = document.createElement('label');
    label.setAttribute('for', name);
    label.textContent = labelText;
    const input = document.createElement(tag || 'input');
    input.id = name;
    input.name = name;
    if (tag !== 'textarea') input.type = 'text';
    root_form_append(label, input);
  }
  function root_form_append(label, input) {
    form.appendChild(label);
    form.appendChild(input);
  }

  field('Full Name', 'full_name');
  field('Email', 'email');
  field('Why this role', 'cover_note', 'textarea');

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.id = 'submit-btn';
  submitBtn.textContent = 'Submit Application';
  submitBtn.onclick = async () => {
    const payload = {
      full_name: document.getElementById('full_name').value,
      email: document.getElementById('email').value,
      cover_note: document.getElementById('cover_note').value,
    };
    const res = await fetch('/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    const confirmation = document.createElement('p');
    confirmation.id = 'confirmation';
    confirmation.textContent = 'Application received. Reference: ' + body.id;
    root.appendChild(confirmation);
  };
  form.appendChild(submitBtn);
  root.appendChild(form);
</script>
</body></html>`;

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export function createJsFormServer() {
  return createServer(async (req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/apply')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(PAGE_HTML);
      return;
    }
    if (req.method === 'POST' && req.url === '/apply') {
      const raw = await readBody(req);
      const fields = JSON.parse(raw);
      const id = `js-app-${randomUUID()}`;
      submissions.set(id, { id, fields, submittedAt: new Date().toISOString() });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id }));
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
  const port = Number(process.env.JS_FORM_PORT ?? 4794);
  createJsFormServer().listen(port, () => console.log(`js-form-target on :${port}`));
}
