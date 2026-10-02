import { NextResponse } from 'next/server';
import { Innertube } from 'youtubei.js';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ✅ Chhoti lekin achhi quality (fast load)
function getBestThumb(thumbnails) {
  if (!thumbnails || thumbnails.length === 0) return '';

  // Sabse badi resolution lo
  const sorted = [...thumbnails].sort((a, b) => {
    const aSize = (a.width || 0) * (a.height || 0);
    const bSize = (b.width || 0) * (b.height || 0);
    return bSize - aSize;
  });

  let url = sorted[0]?.url || '';

  // ✅ w300-h300 - chhoti, tez load, achhi quality
  url = url.replace(/=w\d+-h\d+/, '=w300-h300');
  url = url.replace(/=s\d+/, '=s300');
  url = url.replace(/=w\d+-h\d+-l\d+-rj/, '=w300-h300-l90-rj');

  return url;
}

function extractItems(shelf) {
  const items = [];
  for (const item of shelf.contents || []) {
    if (item.type === 'MusicResponsiveListItem') {
      const videoId = item.id || item.video_id;
      if (!videoId) continue;
      items.push({
        id: videoId,
        title: item.title?.toString?.() || '',
        subtitle:
          item.artists?.map((a) => a.name).join(', ') ||
          item.subtitle?.toString?.() ||
          '',
        thumbnail: getBestThumb(item.thumbnails),
        type: 'song',
      });
    } else if (item.type === 'MusicTwoRowItem') {
      // ✅ Playlists/albums - safe extraction
      const itemId = item.id || '';
      const title = item.title?.toString?.() || '';
      if (!title) continue;

      items.push({
        id: itemId || title,
        title: title,
        subtitle: item.subtitle?.toString?.() || '',
        thumbnail: getBestThumb(item.thumbnails),
        type: item.item_type || 'album',
      });
    }
  }
  return items;
}

export async function GET() {
  try {
    const yt = await Innertube.create({
      lang: 'en',
      location: 'IN',
    });

    const sections = [];

    try {
      const home = await yt.music.getHomeFeed();
      for (const shelf of home.sections || []) {
        if (shelf.type === 'MusicCarouselShelf') {
          const title = shelf.header?.title?.toString?.() || '';
          const items = extractItems(shelf);
          if (items.length > 0 && title) {
            sections.push({ title, items });
          }
        }
      }
    } catch (e) {
      console.warn('[Home] getHomeFeed failed:', e.message);
    }

    if (sections.length === 0) {
      const fallbacks = ['Trending India', 'Top Hits', 'New Releases'];
      for (const q of fallbacks) {
        try {
          const search = await yt.music.search(q, { type: 'song' });
          const songs = search.songs?.contents || [];
          const items = songs
            .filter((s) => s.id || s.video_id)
            .slice(0, 12)
            .map((s) => ({
              id: s.id || s.video_id,
              title: s.title?.toString?.() || '',
              subtitle: s.artists?.map((a) => a.name).join(', ') || '',
              thumbnail: getBestThumb(s.thumbnails),
              type: 'song',
            }));
          if (items.length > 0) {
            sections.push({ title: q, items });
          }
        } catch (e) {
          console.warn(`[Home] Fallback "${q}" failed:`, e.message);
        }
      }
    }

    return NextResponse.json({ sections });
  } catch (error) {
    console.error('[Home Error]', error);
    return NextResponse.json(
      { error: error.message, sections: [] },
      { status: 500 }
    );
  }
}