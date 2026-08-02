import Link from 'next/link';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '1minyt — Terms of Service',
  description:
    'Terms governing your use of 1minyt to organize and summarize YouTube subscriptions.',
};

export default function TermsOfService() {
  return (
    <main style={{ padding: '48px 24px', maxWidth: 760, margin: '0 auto' }}>
      <h1
        style={{
          fontSize: 32,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          marginBottom: 8,
        }}
      >
        Terms of Service
      </h1>
      <p style={{ color: '#8b8b94', fontSize: 13, marginBottom: 32 }}>
        Last updated: August 2, 2026
      </p>

      <Prose>
        <p>
          These Terms of Service (&quot;Terms&quot;) govern your use of 1minyt
          (&quot;the Service&quot;, &quot;we&quot;, &quot;us&quot;, or
          &quot;our&quot;). By accessing or using the Service, you agree to be
          bound by these Terms. If you do not agree, do not use the Service.
        </p>

        <h2>1. The Service</h2>
        <p>
          1minyt helps you organize, search, and summarize your YouTube
          subscriptions by connecting to your YouTube account via the official
          YouTube Data API. The Service is provided &quot;as is&quot; without
          warranties of any kind.
        </p>

        <h2>2. Your Account</h2>
        <p>
          You are responsible for maintaining the confidentiality of any
          credentials, OAuth tokens, and deployment secrets associated with your
          use of the Service. You must be at least 13 years old to use the
          Service.
        </p>

        <h2>3. Your Responsibilities</h2>
        <ul>
          <li>
            You may only connect accounts and access data you own or are
            authorized to access.
          </li>
          <li>
            You will not use the Service to scrape, re-distribute, or violate
            YouTube&apos;s terms, or to store or transmit any infringing or
            unlawful material.
          </li>
          <li>
            You are responsible for your AI provider configuration and the
            content you send for summarization.
          </li>
        </ul>

        <h2>4. Fees &amp; Billing</h2>
        <p>
          Core functionality is free. You are responsible for any costs
          associated with your AI provider, hosting, and YouTube API usage.
          We may introduce paid features in the future; continued use after
          changes constitute acceptance.
        </p>

        <h2>5. Intellectual Property</h2>
        <p>
          The 1minyt software and branding are provided under the project
          license. These Terms do not grant you ownership of any third-party
          content, which remains the property of its respective owners.
        </p>

        <h2>6. Third-Party Services</h2>
        <p>
          The Service integrates with YouTube&apos;s APIs and optional AI
          providers. Your use of those services is governed by their respective
          terms. We are not responsible for third-party conduct.
        </p>

        <h2>7. Disclaimers</h2>
        <p>
          THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot;
          WITHOUT WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
          PURPOSE, OR NON-INFRINGEMENT. We do not warrant that the Service will
          be uninterrupted, secure, or error-free, or that generated summaries
          are accurate.
        </p>

        <h2>8. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, we shall not be liable for any
          indirect, incidental, special, consequential, or punitive damages, or
          any loss of data, profits, or revenue, whether in contract, tort, or
          otherwise, arising out of or related to your use of the Service.
        </p>

        <h2>9. Indemnification</h2>
        <p>
          You agree to indemnify and hold harmless 1minyt and its maintainers
          from any claim, demand, or cause of action arising out of your
          violation of these Terms or applicable law.
        </p>

        <h2>10. Termination</h2>
        <p>
          We may suspend or terminate your access to the Service at any time,
          with or without cause or notice. Upon termination, your license to
          use the Service ends.
        </p>

        <h2>11. Governing Law</h2>
        <p>
          These Terms are governed by the laws of the jurisdiction in which the
          Service is operated, without regard to conflict of law principles.
        </p>

        <h2>12. Changes</h2>
        <p>
          We may revise these Terms from time to time. Your continued use of the
          Service after changes constitute acceptance of the new Terms.
        </p>
      </Prose>

      <p style={{ marginTop: 32, fontSize: 13, color: '#8b8b94' }}>
        <Link href="/" style={{ color: '#5b9eff', textDecoration: 'none' }}>
          ← Back to 1minyt
        </Link>
      </p>
    </main>
  );
}

function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        color: '#c2c2cb',
        lineHeight: 1.7,
        fontSize: 15,
        maxWidth: '68ch',
      }}
    >
      {children}
    </div>
  );
}
