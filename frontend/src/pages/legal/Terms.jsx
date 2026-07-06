import LegalPageLayout from "../../components/legal/LegalPageLayout";
import { BRAND, supportMailto } from "../../lib/brand";

const LAST_UPDATED = "July 6, 2026";

export default function Terms() {
  return (
    <LegalPageLayout
      title="Terms of Use"
      description={`Terms of Use for ${BRAND.NAME} — job matching, assisted applications, and related services at tryhirly.com and app.tryhirly.com.`}
      canonical="/terms"
      lastUpdated={LAST_UPDATED}
    >
      <p>
        These Terms of Use (&quot;Terms&quot;) govern your access to and use of {BRAND.NAME}
        {" "}(the &quot;Service&quot;), including our website at tryhirly.com, our application at
        app.tryhirly.com, and related features. By creating an account or using the Service, you agree
        to these Terms.
      </p>

      <h2>1. Who we are</h2>
      <p>
        The Service is operated by {BRAND.NAME} (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;).
        For questions about these Terms, contact us at{" "}
        <a href={supportMailto("Terms of Use")}>{BRAND.SUPPORT_EMAIL}</a>.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        You must be at least 16 years old and legally able to enter into a binding agreement to use
        the Service. You are responsible for ensuring that your use complies with applicable employment
        and data-protection laws in your country.
      </p>

      <h2>3. The Service</h2>
      <p>{BRAND.NAME} helps you discover job opportunities, prepare application materials, and—where
        supported—submit applications to employers or their applicant tracking systems (ATS). Features
        may include job feeds, CV and cover-letter generation, application tracking, credits, and paid
        subscriptions.</p>
      <ul>
        <li>We do not guarantee interviews, offers, or hiring outcomes.</li>
        <li>Job listings may come from third-party sources (including public APIs such as France Travail).</li>
        <li>Auto-apply and assisted apply features depend on employer systems, job requirements, and your profile.</li>
        <li>We may change, suspend, or discontinue features at any time.</li>
      </ul>

      <h2>4. Your account</h2>
      <p>
        You may sign in with Google OAuth or other methods we support. You are responsible for activity
        under your account and for keeping access to your email secure. Notify us promptly if you suspect
        unauthorized access.
      </p>

      <h2>5. Your content</h2>
      <p>
        You retain ownership of CVs, cover letters, profile information, and other content you upload
        (&quot;User Content&quot;). You grant us a limited license to host, process, and use User Content
        solely to operate and improve the Service—for example, to match jobs, generate tailored documents,
        and submit applications you approve.
      </p>
      <p>
        You represent that you have the right to provide User Content and that it is accurate to the best
        of your knowledge. Do not upload unlawful, misleading, or third-party content without permission.
      </p>

      <h2>6. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service for spam, fraud, or misrepresentation to employers.</li>
        <li>Attempt to bypass rate limits, scrape the Service, or reverse engineer our systems.</li>
        <li>Interfere with other users or the security or integrity of the Service.</li>
        <li>Use the Service in violation of applicable law or third-party terms (including job boards and ATS providers).</li>
      </ul>

      <h2>7. Subscriptions, credits, and billing</h2>
      <p>
        Paid plans and credits are processed by Stripe or other payment providers we designate. Prices,
        billing intervals, and included usage are shown at checkout. Subscriptions renew automatically
        unless cancelled before the renewal date through your billing portal or account settings.
      </p>
      <p>
        Except where required by law, fees are non-refundable once a billing period has started. We may
        change pricing with reasonable notice for future billing periods.
      </p>

      <h2>8. Third-party services</h2>
      <p>
        The Service integrates with third parties (for example Google sign-in, Stripe, job data
        providers, and employer ATS platforms). Your use of those services may be subject to their own
        terms and privacy policies. We are not responsible for third-party websites, job postings, or
        hiring decisions.
      </p>

      <h2>9. Intellectual property</h2>
      <p>
        The Service, including software, design, branding, and documentation (excluding User Content), is
        owned by {BRAND.NAME} or its licensors and protected by intellectual property laws. You may not
        copy, modify, or distribute our materials except as allowed by these Terms.
      </p>

      <h2>10. Disclaimers</h2>
      <p>
        THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY
        KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
        AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT JOB LISTINGS ARE CURRENT, ACCURATE, OR AVAILABLE,
        OR THAT APPLICATIONS WILL BE REVIEWED OR ACCEPTED.
      </p>

      <h2>11. Limitation of liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, {BRAND.NAME.toUpperCase()} AND ITS AFFILIATES WILL NOT BE
        LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF
        PROFITS, DATA, OR GOODWILL, ARISING FROM YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY FOR ANY
        CLAIM RELATING TO THE SERVICE IS LIMITED TO THE GREATER OF (A) THE AMOUNT YOU PAID US IN THE
        TWELVE MONTHS BEFORE THE CLAIM OR (B) EUR 50.
      </p>
      <p>
        Some jurisdictions do not allow certain limitations; in those cases, our liability is limited to
        the fullest extent permitted by law.
      </p>

      <h2>12. Termination</h2>
      <p>
        You may stop using the Service and delete your account at any time from account settings. We may
        suspend or terminate access if you breach these Terms, create risk for us or other users, or where
        required by law. Sections that by nature should survive termination will survive.
      </p>

      <h2>13. Governing law</h2>
      <p>
        These Terms are governed by the laws of France, without regard to conflict-of-law rules. Courts in
        France shall have exclusive jurisdiction, subject to mandatory consumer protections in your country
        of residence if you are a consumer in the European Union.
      </p>

      <h2>14. Changes</h2>
      <p>
        We may update these Terms from time to time. We will post the revised version on this page and
        update the &quot;Last updated&quot; date. Material changes may also be communicated in the app or
        by email. Continued use after changes become effective constitutes acceptance.
      </p>

      <h2>15. Contact</h2>
      <p>
        Questions about these Terms:{" "}
        <a href={supportMailto("Terms of Use")}>{BRAND.SUPPORT_EMAIL}</a>.
      </p>
    </LegalPageLayout>
  );
}
