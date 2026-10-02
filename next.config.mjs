/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    '@napi-rs/canvas',
    'simple-ytdl-core',
    'youtubei.js',
    'bgutils-js',
    'googlevideo',
    'jsdom',
  ],
};

export default nextConfig;