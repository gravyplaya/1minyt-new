import Image from 'next/image';

/**
 * The 1minyt mark (public/images/logo_only.jpg) — square-cropped in a
 * rounded tile, matching the old header treatment at larger sizes.
 */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <Image
      src="/images/logo_only.jpg"
      alt="1minyt logo"
      width={size}
      height={size}
      priority
      style={{ borderRadius: Math.max(5, Math.round(size * 0.28)), objectFit: 'cover', flex: 'none' }}
    />
  );
}
