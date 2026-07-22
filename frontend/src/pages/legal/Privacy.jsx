import LegalPageLayout from "../../components/legal/LegalPageLayout";
import { BRAND, supportMailto } from "../../lib/brand";

const LAST_UPDATED = "July 6, 2026";

export default function Privacy() {
  return (
    <LegalPageLayout
      title="Privacy Policy"
      description={`How ${BRAND.NAME} collects, uses, and protects your personal data when you use our job matching and application services.`}
      canonical="/privacy"
      lastUpdated={LAST_UPDATED}
    >
      <p>
        This Privacy Policy explains how {BRAND.NAME} (&quot;we&quot;, &quot;us&quot;) processes
        personal data when you use tryhirly.com, app.tryhirly.com, and related services (the
        &quot;Service&quot;). We act as a data controller for account and profile data you provide
        to us.
      </p>

      <h2>1. Data we collect</h2>
      <h3>Information you provide</h3>
      <ul>
        <li>
          Account data: name, email address, and authentication identifiers (e.g. Google OAuth).
        </li>
        <li>
          Profile and CV data: work history, skills, education, preferences, uploaded documents, and
          cover letters.
        </li>
        <li>
          Job-search activity: swipes, saved jobs, applications, filters, and feedback you submit.
        </li>
        <li>Support messages and feature requests you send us.</li>
        <li>
          Billing data: processed by Stripe; we receive subscription status and limited payment
          metadata, not full card numbers.
        </li>
      </ul>
      <h3>Information collected automatically</h3>
      <ul>
        <li>
          Device and log data: IP address, browser type, app version, timestamps, and diagnostic
          logs.
        </li>
        <li>
          Usage analytics: pages viewed, features used, and performance metrics to improve the
          Service.
        </li>
        <li>Cookies and similar technologies on our web properties, as described below.</li>
      </ul>

      <h2>2. How we use your data</h2>
      <p>We use personal data to:</p>
      <ul>
        <li>
          Provide the Service: job matching, document generation, application submission, and
          tracking.
        </li>
        <li>Authenticate you and secure your account.</li>
        <li>Process subscriptions, credits, and billing.</li>
        <li>Improve ranking, reliability, and user experience.</li>
        <li>Communicate with you about the Service, security, and support.</li>
        <li>Comply with legal obligations and enforce our Terms of Use.</li>
      </ul>
      <p>
        Where required by GDPR, we rely on contractual necessity, legitimate interests (such as
        product improvement and fraud prevention), consent (where applicable), and legal obligation
        as our legal bases for processing.
      </p>

      <h2>3. AI and automated processing</h2>
      <p>
        We use automated systems—including AI models—to parse CVs, score job fit, and draft
        application materials. You remain responsible for reviewing content before submission where
        preview is available. We do not use your data to train public third-party models unless we
        clearly ask for separate consent.
      </p>

      <h2>4. Sharing with third parties</h2>
      <p>We may share data with:</p>
      <ul>
        <li>
          <strong>Employers and ATS platforms</strong> when you apply to a job (application
          materials and contact details you choose to submit).
        </li>
        <li>
          <strong>Infrastructure providers</strong> such as hosting (e.g. Railway, Vercel), database
          (e.g. Supabase), email, and analytics vendors under data-processing agreements where
          required.
        </li>
        <li>
          <strong>Authentication and payments</strong>: Google (sign-in) and Stripe (billing).
        </li>
        <li>
          <strong>Job data providers</strong> including public APIs (e.g. France Travail) to
          discover listings—we send search parameters, not your full CV, unless needed for a feature
          you use.
        </li>
        <li>
          <strong>Authorities</strong> when required by law or to protect rights, safety, and
          security.
        </li>
      </ul>
      <p>We do not sell your personal data.</p>

      <h2>5. International transfers</h2>
      <p>
        Your data may be processed in the European Union and in other countries where our providers
        operate. When data is transferred outside the EEA, we use appropriate safeguards such as
        Standard Contractual Clauses or equivalent mechanisms where required.
      </p>

      <h2>6. Retention</h2>
      <p>
        We keep account and profile data while your account is active. After deletion, we remove or
        anonymize personal data within a reasonable period, except where retention is required for
        legal, accounting, or security purposes (for example billing records or abuse prevention).
      </p>

      <h2>7. Your rights</h2>
      <p>
        If you are in the EEA, UK, or another region with similar laws, you may have the right to
        access, rectify, erase, restrict, or port your data, and to object to certain processing.
        You may also withdraw consent where processing is consent-based, and lodge a complaint with
        your local supervisory authority.
      </p>
      <p>
        To exercise your rights, email{" "}
        <a href={supportMailto("Privacy request")}>{BRAND.SUPPORT_EMAIL}</a> or delete your account
        in Settings. We may need to verify your identity before responding.
      </p>

      <h2>8. Cookies</h2>
      <p>
        We use essential cookies for authentication and security. We may use analytics cookies to
        understand how the Service is used. You can control non-essential cookies through your
        browser settings; disabling them may affect some features.
      </p>

      <h2>9. Security</h2>
      <p>
        We implement technical and organizational measures appropriate to the risk, including
        encryption in transit, access controls, and secure credential handling. No method of
        transmission or storage is 100% secure.
      </p>

      <h2>10. Children</h2>
      <p>
        The Service is not directed to children under 16. We do not knowingly collect data from
        children. Contact us if you believe a child has provided personal data.
      </p>

      <h2>11. Changes</h2>
      <p>
        We may update this Privacy Policy from time to time. We will post the new version on this
        page and update the &quot;Last updated&quot; date. Material changes may be communicated in
        the app or by email.
      </p>

      <h2>12. Contact</h2>
      <p>
        Data protection inquiries: <a href={supportMailto("Privacy")}>{BRAND.SUPPORT_EMAIL}</a>.
      </p>
    </LegalPageLayout>
  );
}
