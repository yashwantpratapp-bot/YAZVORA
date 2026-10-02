import { NextResponse } from 'next/server';
import { Innertube } from 'youtubei.js';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function getBestThumb(thumbnails) {
  if (!thumbnails || thumbnails.length === 0) return '';
  const sorted = [...thumbnails].sort((a, b) => {
    const aSize = (a.width || 0) * (a.height || 0);
    const bSize = (b.width || 0) * (b.height || 0);
    return bSize - aSize;
  });
  let url = sorted[0]?.url || '';
  url = url.replace(/=w\d+-h\d+/, '=w300-h300');
  url = url.replace(/=s\d+/, '=s300');
  url = url.replace(/=w\d+-h\d+-l\d+-rj/, '=w300-h300-l90-rj');
  return url;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const artistsParam = searchParams.get('artists') || '';
  const artists = artistsParam
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
    .slice(0, 5); // Top 5 artists tak

  if (artists.length === 0) {
    return NextResponse.json({ sections: [] });
  }

  try {
    const yt = await Innertube.create({
      lang: 'en',
      location: 'IN',
    });

    const sections = [];

    // Har top artist ke liye recommendations
    for (const artist of artists) {
      try {
        const search = await yt.music.search(artist, { type: 'song' });
        const songs = search.songs?.contents || [];
        const items = songs
          .filter((s) => s.id || s.video_id)
          .slice(0, 10)
          .map((s) => ({
            id: s.id || s.video_id,
            title: s.title?.toString?.() || '',
            subtitle: s.artists?.map((a) => a.name).join(', ') || '',
            thumbnail: getBestThumb(s.thumbnails),
            type: 'song',
          }));

        if (items.length > 0) {
          sections.push({
            title: `Because you listened to ${artist}`,
            items,
          });
        }
      } catch (e) {
        console.warn(`[Recommend] "${artist}" failed:`, e.message);
      }
    }

    return NextResponse.json({ sections });
  } catch (error) {
    console.error('[Recommend Error]', error);
    return NextResponse.json(
      { error: error.message, sections: [] },
      { status: 500 }
    );
  }
}