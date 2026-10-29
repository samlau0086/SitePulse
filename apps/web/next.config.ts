import type { NextConfig } from 'next';
import path from 'node:path';
import { parseWebEnvironment } from '@sitepulse/config';

const { API_INTERNAL_ORIGIN } = parseWebEnvironment(process.env);
const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(import.meta.dirname, '../..'),
  poweredByHeader: false,
  experimental: {
    // Keep enough framing headroom for the API's exact 8 MiB ZIP limit.
    proxyClientMaxBodySize: '9mb',
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${API_INTERNAL_ORIGIN}/api/v1/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};
export default config;
