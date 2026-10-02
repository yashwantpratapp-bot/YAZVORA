import { NextResponse } from 'next/server';
import YTMusic from 'ytmusic-advanced';

const client = new YTMusic({ mode: 'music', language: 'hi' });

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q') || 'kesariya';

  try {
    // Search karo
    const results = await client.search(query);

    // Pehla song dhundho
    const firstSong = results.find(item => item.type === 'SONG');

    if (!firstSong) {
      return NextResponse.json({ error: 'Koi song nahi mila' }, { status: 404 });
    }

    // Direct audio URL nikaalo
    const audioUrl = await client.getAudioURL(firstSong.videoId, {
      quality: 'best',
      format: 'mp4',
    });

    return NextResponse.json({
      song: {
        id: firstSong.videoId,
        title: firstSong.name,
        artist: firstSong.artist?.name || 'Unknown',
        duration: firstSong.duration,
        thumbnail: firstSong.thumbnails?.[0]?.url,
      },
      streamUrl: audioUrl || 'URL nahi mila',
    });

  } catch (error) {
    return NextResponse.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
}