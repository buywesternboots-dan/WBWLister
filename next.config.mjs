/** @type {import('next').NextConfig} */
const nextConfig = {
  // Bug screenshots are JPEG/WebP data URLs, capped around 3MB. The proxy clones the body; the default 10MB already fits.
  experimental: { proxyClientMaxBodySize: '6mb' },
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }];
  },
};

export default nextConfig;
