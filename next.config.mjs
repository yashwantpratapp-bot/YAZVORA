/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  turbopack: {},
  serverExternalPackages: [
    'youtubei.js',
    'simple-ytdl-core',
    'canvas',
    '@napi-rs/canvas',
    'jsdom',
    'bgutils-js',
    'googlevideo',
  ],
  compress: true,
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
};

export default nextConfig;