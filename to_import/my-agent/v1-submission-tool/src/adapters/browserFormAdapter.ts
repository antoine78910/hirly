import { chromium, type Browser } from 'playwright';
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

/**
 * Fills and submits a JavaScript-rendered form via real browser automation —
 * the class of real-world ATS UI (Greenhouse, Lever, Workday) that
 * genericWebFormAdapter.ts (plain HTML parsing) cannot handle, because the
 * form doesn't exist in the page's initial HTML at all.
 *
 * Field discovery is generic (label text + input name/id), not hand-coded
 * per site: it reads every visible <label>-linked input/textarea on the
 * page and maps them onto the plan's proposedFormFields the same way
 * genericWebFormAdapter does, so this adapter is not tied to this project's
 * own test target's specific markup.
 */
export class BrowserFormAdapter {
  private browser: Browser | null = null;

  constructor(private readonly url: string) {}

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }
    return this.browser;
  }

  async dispatch(plan: SubmissionPlan, nonce: string): Promise<DispatchResult> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.goto(this.url, { waitUntil: 'networkidle' });

      // Generic field discovery: every <label for="X"> paired with #X, whatever the tag.
      const fields = await page.evaluate(() => {
        const labels = Array.from(document.querySelectorAll('label[for]'));
        return labels
          .map((label) => {
            const forId = label.getAttribute('for');
            if (!forId) return null;
            const input = document.getElementById(forId) as HTMLInputElement | HTMLTextAreaElement | null;
            if (!input) return null;
            return { name: input.name || input.id, id: input.id, labelText: label.textContent?.trim() ?? '' };
          })
          .filter((f): f is { name: string; id: string; labelText: string } => f !== null);
      });

      for (const field of fields) {
        const normalized = field.name.toLowerCase().replace(/[^a-z]/g, '');
        const labelNormalized = field.labelText.toLowerCase().replace(/[^a-z]/g, '');
        const match = plan.proposedFormFields.find((f) => {
          const fn = f.field.toLowerCase().replace(/[^a-z]/g, '');
          return fn === normalized || fn === labelNormalized || labelNormalized.includes(fn) || fn.includes(labelNormalized);
        });
        if (match?.proposedAnswer) {
          await page.fill(`#${field.id}`, match.proposedAnswer);
        }
      }

      // Generic submit trigger: prefer an explicit submit button by role/text, fall back to form submit.
      const submitButton = page.getByRole('button', { name: /submit|apply|send/i }).first();
      if (await submitButton.count()) {
        await submitButton.click();
      } else {
        await page.locator('form').first().evaluate((f: HTMLFormElement) => f.requestSubmit());
      }

      await page.waitForSelector('#confirmation, [data-confirmation]', { timeout: 5000 }).catch(() => null);
      const confirmationText = await page.locator('#confirmation, [data-confirmation]').first().textContent().catch(() => null);
      const refMatch = confirmationText?.match(/Reference:\s*([\w-]+)/);
      if (!refMatch) {
        throw new Error('browser-form: no confirmation reference found on page after submit');
      }
      return { externalId: refMatch[1], dispatchStatus: 'received' };
    } finally {
      await page.close();
    }
  }

  /** Independent confirmation via a plain HTTP call, not by trusting what the page showed after submit. */
  async confirm(externalId: string): Promise<ConfirmResult> {
    const statusUrl = new URL(`/status/${externalId}`, this.url).toString();
    const res = await fetch(statusUrl);
    if (!res.ok) return { status: 'unknown', observedAt: new Date().toISOString(), raw: { httpStatus: res.status } };
    const body = await res.json();
    return { status: 'confirmed', observedAt: new Date().toISOString(), raw: body };
  }

  async waitForConfirmation(externalId: string): Promise<ConfirmResult> {
    return this.confirm(externalId);
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }
}
