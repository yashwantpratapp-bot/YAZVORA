import { NextResponse } from 'next/server';
import { Innertube } from 'youtubei.js';
export const maxDuration = 60;
export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

// Recursive: poori tree mein MusicResponsiveListItem dhundho (id check karo, video_id nahi)
function findSongs(node, results = [], visited = new Set()) {
  if (!node || visited.has(node)) return results;
  visited.add(node);

  if (node.type === 'MusicResponsiveListItem' && (node.id || node.video_id)) {
    results.push(node);
    return results;
  }

  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) {
      value.forEach(child => findSongs(child, results, visited));
    } else if (value && typeof value === 'object' && value.type) {
      findSongs(value, results, visited);
    }
  }

  return results;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q') || 'kesariya';

  try {
    const yt = await Innertube.create({ 
      lang: 'hi', 
      location: 'IN' 
    });

    const search = await yt.music.search(query, { type: 'song' });
    const allSongs = findSongs({ contents: search.contents });

    const results = allSongs.slice(0, 15).map(song => ({
      id: song.id || song.video_id,
      title: song.title?.toString?.() || song.title || 'Unknown',
      artist: song.artists?.map(a => a.name).join(', ') || 'Unknown',
      duration: song.duration?.text || '',
      thumbnail: song.thumbnails?.[song.thumbnails.length - 1]?.url || '',
    })).filter(s => s.id);

    return NextResponse.json({ results, _debug: { totalFound: allSongs.length } });
  } catch (error) {
    console.error('[Search Error]', error);
    return NextResponse.json({ 
      error: error.message,
      results: [] 
    }, { status: 500 });
  }
}