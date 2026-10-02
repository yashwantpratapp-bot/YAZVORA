import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get('id');

  if (!videoId) {
    return NextResponse.json({ error: 'id missing' }, { status: 400 });
  }

  // Proxy URL return karo
  return NextResponse.json({
    streamUrl: `/api/audio?id=${videoId}`,
  });
}