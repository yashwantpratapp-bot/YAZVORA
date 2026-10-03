import { Innertube, Platform } from 'youtubei.js';
import { downloadMultiStep } from 'simple-ytdl-core';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ✅ Deciphering ke liye zaroori
Platform.shim.eval = async (data) => {
  return new Function(data.output)();
};

// ✅ Multi-client fallback — ek fail ho toh doosra try kare
async function tryDownload(videoId) {
  const clients = ['TV', 'WEB_REMIX', 'MWEB'];

  for (const clientType of clients) {
    try {
      console.log(`[Audio] Trying client: ${clientType}`);

      const yt = await Innertube.create({
        lang: 'hi',
        location: 'IN',
        client_type: clientType,
        retrieve_player: true,
      });

      const stream = await downloadMultiStep(yt, videoId, 'audio', 'SABR');

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      if (buffer.length > 0) {
        console.log(`[Audio] ✅ ${clientType} worked: ${buffer.length} bytes`);
        return buffer;
      }
    } catch (err) {
      console.warn(`[Audio] ❌ ${clientType} failed:`, err.message);
    }
  }

  throw new Error('All clients failed to extract stream');
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get('id');

  if (!videoId) {
    return new Response('Missing id', { status: 400 });
  }

  try {
    const buffer = await tryDownload(videoId);

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mp4',
        'Content-Length': buffer.length.toString(),
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('[Audio Error]', error);
    return new Response('Stream failed: ' + error.message, { status: 500 });
  }
}