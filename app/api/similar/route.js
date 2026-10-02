import { NextResponse } from 'next/server';
import { Innertube } from 'youtubei.js';

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
      value.forEach((child) => findSongs(child, results, visited));
    } else if (value && typeof value === 'object' && value.type) {
      findSongs(value, results, visited);
    }
  }
  return results;
}

// ✅ Query list banao - artist + title keywords se
function buildQueries(artist, title) {
  const queries = [];

  // 1. Main artist ka naam
  if (artist) {
    const mainArtist = artist.split(',')[0].trim();
    if (mainArtist && mainArtist.toLowerCase() !== 'unknown') {
      queries.push(mainArtist);
    }
    // 2. Second artist bhi (agar hai)
    const artists = artist.split(',').map((a) => a.trim()).filter(Boolean);
    if (artists.length > 1) {
      queries.push(artists[1]);
    }
  }

  // 3. Title ke important keywords
  if (title) {
    const clean = title
      .replace(/\(.*?\)/g, '')      // brackets hatao
      .replace(/\[.*?\]/g, '')
      .replace(/["']/g, '')
      .trim();
    // Pehle 2-3 words
    const keywords = clean.split(/\s+/).slice(0, 2).join(' ');
    if (keywords && keywords.length > 2) {
      queries.push(keywords);
    }
  }

  return [...new Set(queries)].slice(0, 3);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const artist = searchParams.get('artist') || '';
  const excludeId = searchParams.get('exclude') || '';
  const title = searchParams.get('title') || '';

  if (!artist && !title) {
    return NextResponse.json({ results: [] });
  }

  try {
    const yt = await Innertube.create({ lang: 'en', location: 'IN' });
    const queries = buildQueries(artist, title);

    const allSongs = [];
    const seen = new Set(excludeId ? [excludeId] : []);
    const targetCount = 20;

    for (const q of queries) {
      if (allSongs.length >= targetCount) break;
      try {
        const search = await yt.music.search(q, { type: 'song' });
        const songs = findSongs({ contents: search.contents });

        for (const s of songs) {
          if (allSongs.length >= targetCount) break;
          const id = s.id || s.video_id;
          if (!id || seen.has(id)) continue;

          // Song khud ka artist match karo (optional but better)
          const songArtists = s.artists?.map((a) => a.name).join(', ') || '';
          
          seen.add(id);
          allSongs.push({
            id,
            title: s.title?.toString?.() || '',
            artist: songArtists,
            duration: s.duration?.text || '',
            thumbnail: getBestThumb(s.thumbnails),
            _score: songArtists.toLowerCase().includes(
              (artist.split(',')[0] || '').trim().toLowerCase()
            )
              ? 2
              : 1, // same artist ko zyada priority
          });
        }
      } catch (e) {
        console.warn(`[Similar] Query "${q}" failed:`, e.message);
      }
    }

    // Same artist wale songs upar rakho, phir baaki
    allSongs.sort((a, b) => b._score - a._score);
    const results = allSongs.map(({ _score, ...rest }) => rest);

    return NextResponse.json({ results });
  } catch (error) {
    console.error('[Similar Error]', error);
    return NextResponse.json(
      { error: error.message, results: [] },
      { status: 500 }
    );
  }
}