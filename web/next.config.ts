import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // SSR/ISR on Cloud Run, with Firebase Hosting as the global front door.
  output: 'standalone',
  // Workspace UI packages ship TSX/CSS source and must be transpiled by Next.
  transpilePackages: ['@yivents/shared', '@yivents/ui', '@yivents/ticket-render'],
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'firebasestorage.googleapis.com' }],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default nextConfig;
