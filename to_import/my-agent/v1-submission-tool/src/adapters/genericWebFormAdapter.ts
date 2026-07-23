import type { SubmissionPlan } from '../schemas.js';

export interface DispatchResult {
  externalId: string;
  dispatchStatus: 'received' | 'replay';
}
export interface ConfirmResult {
  status: 'confirmed' | 'rejected' | 'unknown';
  observedAt: string;
  raw: unknown;
}

interface ParsedField {
  name: string;
  tag: 'input' | 'textarea';
  type?: string;
}

interface ParsedForm {
  action: string;
  method: string;
  fields: ParsedField[];
}

/**
 * Minimal, honest scope: parses standard server-rendered HTML <form> tags
 * (input/textarea with name= attributes) and submits via a normal POST. This
 * covers plain HTML forms — including this project's own test target — but
 * NOT JavaScript-rendered SPA forms (React/Vue-driven ATS UIs), which would
 * need real browser automation (Playwright) to fill. That's a real, flagged
 * gap — see NEXT-DIRECTIONS — not something this adapter silently papers over.
 */
export function parseFirstForm(html: string): ParsedForm | null {
  const formMatch = html.match(/<form[^>]*action=["']([^"']*)["'][^>]*method=["']([^"']*)["'][^>]*>([\s\S]*?)<\/form>/i);
  if (!formMatch) return null;
  const [, action, method, body] = formMatch;
  const fields: ParsedField[] = [];
  const inputRe = /<input\b[^>]*\bname=["']([^"']+)["'][^>]*\/?>/gi;
  const typeRe = /\btype=["']([^"']+)["']/i;
  let m: RegExpExecArray | null;
  while ((m = inputRe.exec(body))) {
    const tagText = m[0];
    const typeM = tagText.match(typeRe);
    fields.push({ name: m[1], tag: 'input', type: typeM?.[1] ?? 'text' });
  }
  const textareaRe = /<textarea\b[^>]*\bname=["']([^"']+)["'][^>]*>/gi;
  while ((m = textareaRe.exec(body))) {
    fields.push({ name: m[1], tag: 'textarea' });
  }
  return { action, method: method.toUpperCase(), fields };
}

/** Maps the plan's proposed form fields onto the parsed form's actual field names by loose label/name matching. */
export function mapFieldsByName(parsed: ParsedField[], plan: SubmissionPlan): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pf of parsed) {
    const normalized = pf.name.toLowerCase().replace(/[^a-z]/g, '');
    const match = plan.proposedFormFields.find((f) => {
      const fn = f.field.toLowerCase().replace(/[^a-z]/g, '');
      return fn === normalized || fn.includes(normalized) || normalized.includes(fn);
    });
    if (match?.proposedAnswer) out[pf.name] = match.proposedAnswer;
  }
  return out;
}

export class GenericWebFormAdapter {
  constructor(private readonly baseUrl: string) {}

  async dispatch(plan: SubmissionPlan, nonce: string): Promise<DispatchResult> {
    const pageRes = await fetch(this.baseUrl);
    if (!pageRes.ok) throw new Error(`generic-web-form: could not fetch form page (${pageRes.status})`);
    const html = await pageRes.text();
    const form = parseFirstForm(html);
    if (!form) throw new Error('generic-web-form: no <form> found on page — cannot fill blind');

    const mapped = mapFieldsByName(form.fields, plan);
    mapped['_nonce'] = nonce; // carried through so the test target's status lookup can be nonce-correlated if needed

    const actionUrl = new URL(form.action, this.baseUrl).toString();
    const res = await fetch(actionUrl, {
      method: form.method || 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(mapped).toString(),
    });
    if (!res.ok) throw new Error(`generic-web-form: submit failed (${res.status})`);
    const body = await res.text();
    const refMatch = body.match(/Reference:\s*([\w-]+)/);
    if (!refMatch) throw new Error('generic-web-form: no confirmation reference found in response');
    return { externalId: refMatch[1], dispatchStatus: 'received' };
  }

  async confirm(externalId: string): Promise<ConfirmResult> {
    const res = await fetch(`${this.baseUrl}/status/${externalId}`);
    if (!res.ok) return { status: 'unknown', observedAt: new Date().toISOString(), raw: { httpStatus: res.status } };
    const body = await res.json();
    return { status: 'confirmed', observedAt: new Date().toISOString(), raw: body };
  }

  async waitForConfirmation(externalId: string): Promise<ConfirmResult> {
    // The test target confirms synchronously on submit (no async processing to await),
    // but we still make a SEPARATE independent call rather than trusting dispatch()'s response.
    return this.confirm(externalId);
  }
}
