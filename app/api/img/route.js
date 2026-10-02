// In-memory cache for images
const imageCache = new Map();
const CACHE_LIMIT = 200;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return new Response('Missing url', { status: 400 });
  }

  // ✅ Cache check
  if (imageCache.has(url)) {
    const cached = imageCache.get(url);
    return new Response(cached.buffer, {
      status: 200,
      headers: {
        'Content-Type': cached.contentType,
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  }

  const allowed = [
    'https://yt3.googleusercontent.com',
    'https://i.ytimg.com',
    'https://lh3.googleusercontent.com',
    'https://yt3.ggpht.com',
  ];

  if (!allowed.some((domain) => url.startsWith(domain))) {
    return new Response('Invalid domain', { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: {
        'Referer': 'https://www.youtube.com/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });

    if (!res.ok) {
      return new Response('Failed', { status: res.status });
    }

    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || 'image/jpeg';

    // ✅ Cache mein save
    if (imageCache.size >= CACHE_LIMIT) {
      const firstKey = imageCache.keys().next().value;
      imageCache.delete(firstKey);
    }
    imageCache.set(url, { buffer, contentType });

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  } catch (err) {
    return new Response('Error: ' + err.message, { status: 500 });
  }
}