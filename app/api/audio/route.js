import { Innertube, Platform } from 'youtubei.js';
import { downloadMultiStep } from 'simple-ytdl-core';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ✅ Deciphering ke liye custom evaluator
Platform.shim.eval = async (data) => {
  return new Function(data.output)();
};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get('id');

  if (!videoId) {
    return new Response('Missing id', { status: 400 });
  }

  try {
    const yt = await Innertube.create({
      lang: 'hi',
      location: 'IN',
      client_type: 'TV',       // ✅ TV client - SABR exempt
      retrieve_player: true,
    });

    // ✅ downloadMultiStep - SABR + Adaptive dono try karta hai
    const stream = await downloadMultiStep(yt, videoId, 'audio', 'SABR');

    // Buffer karo
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    console.log(`[Audio] ${buffer.length} bytes for ${videoId}`);

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