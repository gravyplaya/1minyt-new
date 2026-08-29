/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['pg', 'google-auth-library', 'googleapis', 'youtubei.js'],
};

export default nextConfig;
