import Link from 'next/link';

export function Footer() {
  return (
    <footer
      style={{
        marginTop: 'auto',
        borderTop: '1px solid #2a2a33',
        background: '#0a0a0c',
        padding: '24px 24px',
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          fontSize: 13,
          color: '#5a5a64',
        }}
      >
        <span style={{ color: '#8b8b94' }}>
          © {new Date().getFullYear()} 1minyt. All rights reserved.
        </span>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <FooterLink href="/terms">Terms of Service</FooterLink>
          <FooterLink href="/privacy">Privacy Policy</FooterLink>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      style={{
        color: '#5b9eff',
        textDecoration: 'none',
        fontSize: 13,
      }}
    >
      {children}
    </Link>
  );
}
