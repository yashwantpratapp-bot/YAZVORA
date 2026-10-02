/** @type {import('next').NextConfig} */
const nextConfig = {
  // ✅ Turbopack config (silences warning)
  turbopack: {},

  // ✅ Native packages ko server-side bundle se exclude karo
  serverExternalPackages: [
    'youtubei.js',
    'simple-ytdl-core',
    'canvas',
    '@napi-rs/canvas',
    'jsdom',
    'bgutils-js',
  ],

  // ✅ Production optimizations
  compress: true,
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
};

export default nextConfig;