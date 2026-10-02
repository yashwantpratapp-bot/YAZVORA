import { Innertube, Platform } from 'youtubei.js';
import { downloadMultiStep } from 'simple-ytdl-core';

// Deciphering ke liye zaroori
Platform.shim.eval = async (data) => new Function(data.output)();

// ✅ Server-side cache (same song dobara click pe instant)
const audioCache = new Map();
const CACHE_LIMIT = 50; // 50 songs tak cache

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get('id');

  if (!videoId) {
    return new Response('Missing id', { status: 400 });
  }

  // ✅ Cache check - agar already buffered hai toh seedha bhejo
  if (audioCache.has(videoId)) {
    const cached = audioCache.get(videoId);
    console.log(`[Audio] Cache HIT: ${videoId} (${cached.length} bytes)`);
    return new Response(cached, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mp4',
        'Content-Length': cached.length.toString(),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  try {
    const yt = await Innertube.create({
      lang: 'hi',
      location: 'IN',
      client_type: 'TV',              // ✅ TV client - SABR exempt
      retrieve_player: true,
    });

    // ✅ downloadMultiStep - SABR + Adaptive dono try karta hai
    const stream = await downloadMultiStep(yt, videoId, 'audio', 'SABR');

    // Poora buffer karo (4-5 MB, memory mein fit)
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Cache mein daalo (LRU-style)
    if (audioCache.size >= CACHE_LIMIT) {
      const firstKey = audioCache.keys().next().value;
      audioCache.delete(firstKey);
    }
    audioCache.set(videoId, buffer);

    console.log(`[Audio] Buffered ${buffer.length} bytes for ${videoId}`);

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mp4',
        'Content-Length': buffer.length.toString(),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('[Audio Error]', error);
    return new Response('Stream failed: ' + error.message, { status: 500 });
  }
}