import { NextResponse } from 'next/server';
import { Innertube } from 'youtubei.js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get('id');

  if (!videoId) {
    return NextResponse.json({ error: 'Missing id', lyrics: '', timed: false }, { status: 400 });
  }

  try {
    const yt = await Innertube.create({ lang: 'en', location: 'IN' });

    // ✅ Timed lyrics try karo (LRC format)
    let lyricsData;
    try {
      lyricsData = await yt.music.getLyrics(videoId, { timestamps: true });
    } catch (e) {
      // Fallback: plain lyrics
      lyricsData = await yt.music.getLyrics(videoId);
    }

    // ✅ Check karo timed hai ya nahi
    const isTimed =
      lyricsData?.has_timestamps === true ||
      (typeof lyricsData?.text === 'string' && /^\[\d{2}:\d{2}/m.test(lyricsData.text));

    let lyricsText = '';
    if (lyricsData?.description?.text) lyricsText = lyricsData.description.text;
    else if (lyricsData?.text) lyricsText = lyricsData.text;
    else if (typeof lyricsData === 'string') lyricsText = lyricsData;

    return NextResponse.json({
      lyrics: lyricsText || '',
      timed: isTimed && !!lyricsText,
      hasLyrics: !!lyricsText,
    });
  } catch (error) {
    console.error('[Lyrics Error]', error.message);
    return NextResponse.json({ lyrics: '', timed: false, hasLyrics: false });
  }
}