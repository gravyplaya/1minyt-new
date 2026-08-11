import Link from 'next/link';

/**
 * Adaptive rail for the Settings tab.
 * Sub-nav for Integrations and Labs (Digests).
 */

const railHeading: React.CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontSize: 11,
  color: '#8b8b94',
  marginBottom: 8,
  fontWeight: 600,
};

export type SettingsSection = 'integrations' | 'digests';

export function SettingsRail({ active }: { active: SettingsSection }) {
  const items: Array<{ id: SettingsSection; label: string; icon: string; href: string }> = [
    { id: 'integrations', label: 'Integrations', icon: '⚙', href: '/settings' },
    { id: 'digests', label: 'Labs / Digests', icon: '📋', href: '/digests' },
  ];

  return (
    <aside className="rail" style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 24, overflow: 'auto' }}>
      <section>
        <h3 style={railHeading}>Settings</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 6,
                fontSize: 13,
                color: active === item.id ? '#fff' : '#c2c2cb',
                background: active === item.id ? '#1f1f26' : 'transparent',
                textDecoration: 'none',
              }}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </div>
      </section>
    </aside>
  );
}
