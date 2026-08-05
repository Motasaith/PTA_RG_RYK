/** @type {import('next').NextConfig} */
const nextConfig = {
  // The game is 100% client-side, so we ship a static bundle — ideal for
  // Cloudflare Pages / Workers static assets (no Node runtime, no cold starts).
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  // One WebGL context per mount: StrictMode's double-invoke would build the city twice.
  reactStrictMode: false,
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
