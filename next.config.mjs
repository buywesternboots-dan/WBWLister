/** @type {import('next').NextConfig} */
const nextConfig = {
  // Bug screenshots are JPEG/WebP data URLs, capped around 3MB. The proxy clones the body; the default 10MB already fits.
  experimental: { proxyClientMaxBodySize: '6mb' },
  // The maker snapshot is read with fs from process.cwd(), so the tracer must be told to ship it.
  outputFileTracingIncludes: {
    '/api/items': ['./data/wbw-reference/makers.csv'],
    '/api/items/route': ['./data/wbw-reference/makers.csv'],
    '/*': ['./data/wbw-reference/makers.csv'],
  },
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }];
  },
};

export default nextConfig;
