'use client';
import { useState, useRef, useEffect } from 'react';

function proxyImg(url) {
  if (!url) return '';
  return `/api/img?url=${encodeURIComponent(url)}`;
}

function parseLRC(lrcText) {
  if (!lrcText) return [];
  const lines = lrcText.split('\n');
  const result = [];
  const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
  for (const line of lines) {
    const matches = [...line.matchAll(timeRegex)];
    if (matches.length === 0) continue;
    const text = line.replace(timeRegex, '').trim();
    if (!text) continue;
    for (const m of matches) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const ms = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0;
      result.push({ time: min * 60 + sec + ms / 1000, text });
    }
  }
  return result.sort((a, b) => a.time - b.time);
}

function getHistory() {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem('yazvora_history') || '[]'); } catch { return []; }
}
function saveToHistory(song) {
  if (typeof window === 'undefined') return;
  try {
    const history = getHistory();
    const filtered = history.filter((h) => h.id !== song.id);
    filtered.unshift({ id: song.id, title: song.title, artist: song.artist, thumbnail: song.thumbnail, timestamp: Date.now() });
    localStorage.setItem('yazvora_history', JSON.stringify(filtered.slice(0, 100)));
  } catch (err) {}
}
function getTopArtists() {
  const history = getHistory();
  if (history.length === 0) return [];
  const counts = {};
  for (const item of history) {
    const artists = (item.artist || '').split(',').map((a) => a.trim()).filter(Boolean);
    for (const artist of artists) counts[artist] = (counts[artist] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name);
}
function getLiked() {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem('yazvora_liked') || '[]'); } catch { return []; }
}
function saveLiked(list) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('yazvora_liked', JSON.stringify(list));
}

export default function Home() {
  const [tab, setTab] = useState('home');

  const [query, setQuery] = useState('');
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [buffering, setBuffering] = useState(false);
  const [categories, setCategories] = useState([]);
  const [catLoading, setCatLoading] = useState(true);
  const [recent, setRecent] = useState([]);
  const [liked, setLiked] = useState([]);
  const [fullPlayer, setFullPlayer] = useState(false);

  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const [showQueue, setShowQueue] = useState(false);

  const [lyrics, setLyrics] = useState('');
  const [timedLyrics, setTimedLyrics] = useState([]);
  const [activeLyric, setActiveLyric] = useState(-1);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const lyricsContainerRef = useRef(null);
  const lyricLineRefs = useRef([]);

  const [sleepMinutes, setSleepMinutes] = useState(0);
  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const sleepRef = useRef(null);

  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const analyserRef = useRef(null);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(null);
  const activeLyricRef = useRef(-1);
  const currentSongIdRef = useRef(null);

  useEffect(() => {
    async function loadHome() {
      const history = getHistory();
      setRecent(history.slice(0, 10));
      setLiked(getLiked());
      const topArtists = getTopArtists();
      const [homeRes, recRes] = await Promise.allSettled([
        fetch('/api/home').then((r) => r.json()),
        topArtists.length > 0
          ? fetch(`/api/recommend?artists=${encodeURIComponent(topArtists.join(','))}`).then((r) => r.json())
          : Promise.resolve({ sections: [] }),
      ]);
      const homeSections = homeRes.status === 'fulfilled' ? homeRes.value.sections || [] : [];
      const recSections = recRes.status === 'fulfilled' ? recRes.value.sections || [] : [];
      setCategories([...recSections, ...homeSections]);
      setCatLoading(false);
    }
    loadHome();
  }, []);

  function initVisualizer() {
    if (audioCtxRef.current || !audioRef.current) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      const source = ctx.createMediaElementSource(audioRef.current);
      source.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) {}
  }

  function drawVisualizer() {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      if (!canvasRef.current) return;
      analyser.getByteFrequencyData(dataArray);
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const barCount = 64, gap = 2;
      const barWidth = (w - gap * (barCount - 1)) / barCount;
      const step = Math.floor(bufferLength / barCount);
      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += dataArray[i * step + j];
        const avg = sum / step;
        const barHeight = (avg / 255) * h;
        const x = i * (barWidth + gap);
        const y = h - barHeight;
        const gradient = ctx.createLinearGradient(0, y, 0, h);
        gradient.addColorStop(0, 'rgba(29, 185, 84, 0.9)');
        gradient.addColorStop(1, 'rgba(29, 185, 84, 0.2)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, Math.min(barWidth / 2, 2));
        ctx.fill();
      }
    };
    draw();
  }

  useEffect(() => {
    if (fullPlayer && isPlaying) {
      initVisualizer();
      if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume().catch(() => {});
      drawVisualizer();
    }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [fullPlayer, isPlaying]);

  useEffect(() => {
    if (sleepMinutes <= 0) return;
    if (sleepRef.current) clearInterval(sleepRef.current);
    sleepRef.current = setInterval(() => {
      setSleepMinutes((prev) => {
        if (prev <= 1) {
          clearInterval(sleepRef.current);
          sleepRef.current = null;
          if (audioRef.current) audioRef.current.pause();
          return 0;
        }
        return prev - 1;
      });
    }, 60000);
    return () => { if (sleepRef.current) clearInterval(sleepRef.current); };
  }, [sleepMinutes]);

  function setSleepTimer(minutes) { setSleepMinutes(minutes); setShowSleepMenu(false); }

  function toggleLike(song, e) {
    if (e) e.stopPropagation();
    const current = getLiked();
    const exists = current.find((s) => s.id === song.id);
    let updated;
    if (exists) updated = current.filter((s) => s.id !== song.id);
    else updated = [{ id: song.id, title: song.title, artist: song.artist, thumbnail: song.thumbnail, duration: song.duration }, ...current];
    saveLiked(updated);
    setLiked(updated);
  }

  function isLiked(songId) { return liked.some((s) => s.id === songId); }

  async function loadLyrics(songId) {
    setLyricsLoading(true);
    setLyrics('');
    setTimedLyrics([]);
    setActiveLyric(-1);
    activeLyricRef.current = -1;
    try {
      const res = await fetch(`/api/lyrics?id=${songId}`);
      const data = await res.json();
      if (data.timed && data.lyrics) {
        const parsed = parseLRC(data.lyrics);
        if (parsed.length > 0) { setTimedLyrics(parsed); setLyrics(data.lyrics); return; }
      }
      setLyrics(data.lyrics || '');
    } catch (err) { setLyrics(''); }
    finally { setLyricsLoading(false); }
  }

  async function handleCardClick(item) {
    if (item.type === 'song') {
      playSong(item);
    } else {
      setQuery(item.title);
      setTab('search');
      setSearched(true);
      setLoading(true);
      setSongs([]);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(item.title)}`);
        const data = await res.json();
        setSongs(data.results || []);
      } catch (err) {} finally { setLoading(false); }
    }
  }

  async function searchSongs(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    setSongs([]);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setSongs(data.results || []);
    } catch (err) { alert('Search fail: ' + err.message); }
    finally { setLoading(false); }
  }

  async function playSong(song) {
    if (!song?.id) return;
    currentSongIdRef.current = song.id;
    setCurrentSong(song);
    setProgress(0);
    setDuration(0);
    setBuffering(true);
    setLyrics('');
    setTimedLyrics([]);
    setActiveLyric(-1);
    activeLyricRef.current = -1;
    saveToHistory(song);
    setRecent(getHistory().slice(0, 10));
    if (audioRef.current) {
      audioRef.current.src = `/api/audio?id=${song.id}`;
      audioRef.current.load();
      audioRef.current.play().then(() => {
        setBuffering(false);
        if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume().catch(() => {});
      }).catch(() => setBuffering(false));
    }
    loadLyrics(song.id);
    setQueue([song]);
    setCurrentIndex(0);
    try {
      const params = new URLSearchParams({ artist: song.artist || '', title: song.title || '', exclude: song.id });
      const res = await fetch(`/api/similar?${params.toString()}`);
      const data = await res.json();
      if (currentSongIdRef.current !== song.id) return;
      if (data.results && data.results.length > 0) {
        setQueue([song, ...data.results]);
        setCurrentIndex(0);
      }
    } catch (err) {}
  }

  function togglePlay() {
    if (!audioRef.current || !currentSong) return;
    if (isPlaying) audioRef.current.pause();
    else {
      audioRef.current.play();
      if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume().catch(() => {});
    }
  }

  function playNext(fromEnded = false) {
    if (!queue.length) return;
    if (fromEnded && repeat === 'one') {
      if (audioRef.current) { audioRef.current.currentTime = 0; audioRef.current.play(); }
      return;
    }
    let nextIndex;
    if (shuffle) {
      nextIndex = Math.floor(Math.random() * queue.length);
      if (queue.length > 1 && nextIndex === currentIndex) nextIndex = (nextIndex + 1) % queue.length;
    } else {
      nextIndex = currentIndex + 1;
      if (nextIndex >= queue.length) {
        if (repeat === 'all') nextIndex = 0;
        else if (fromEnded) { setIsPlaying(false); return; }
        else nextIndex = 0;
      }
    }
    playSong(queue[nextIndex]);
  }

  function playPrev() {
    if (!queue.length) return;
    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) { if (repeat === 'all') prevIndex = queue.length - 1; else prevIndex = 0; }
    playSong(queue[prevIndex]);
  }

  function addToQueue(song, e) {
    if (e) e.stopPropagation();
    if (!song?.id) return;
    if (queue.find((s) => s.id === song.id)) return;
    setQueue((prev) => [...prev, song]);
  }

  function removeFromQueue(index, e) {
    if (e) e.stopPropagation();
    setQueue((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      if (index < currentIndex) setCurrentIndex((ci) => ci - 1);
      else if (index === currentIndex && updated.length > 0) {
        const nextIdx = Math.min(index, updated.length - 1);
        setCurrentIndex(nextIdx);
        playSong(updated[nextIdx]);
      }
      return updated;
    });
  }

  function clearQueue() {
    if (currentSong) { setQueue([currentSong]); setCurrentIndex(0); }
    else { setQueue([]); setCurrentIndex(-1); }
  }

  function cycleRepeat() { setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')); }

  function handleSeek(e) {
    const t = parseFloat(e.target.value);
    if (audioRef.current) { audioRef.current.currentTime = t; setProgress(t); }
  }

  function handleVolume(e) {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  }

  function formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function clearHistory() {
    if (!confirm('Listening history clear karni hai?')) return;
    localStorage.removeItem('yazvora_history');
    setRecent([]);
  }

  function syncLyrics(currentTime) {
    if (timedLyrics.length === 0) return;
    let idx = -1;
    for (let i = 0; i < timedLyrics.length; i++) {
      if (timedLyrics[i].time <= currentTime) idx = i;
      else break;
    }
    if (idx !== activeLyricRef.current) {
      activeLyricRef.current = idx;
      setActiveLyric(idx);
      const el = lyricLineRefs.current[idx];
      if (el && lyricsContainerRef.current) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);

  const repeatActive = repeat !== 'off';

  return (
    <>
      <style jsx global>{`
        * { box-sizing: border-box; }
        html, body {
          margin: 0; padding: 0;
          background: #0a0a0f; color: #fff;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        input[type='range'] {
          -webkit-appearance: none; appearance: none;
          background: transparent; cursor: pointer; height: 24px;
        }
        input[type='range']::-webkit-slider-runnable-track { height: 4px; background: #333; border-radius: 2px; }
        input[type='range']::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          height: 14px; width: 14px; border-radius: 50%;
          background: #1db954; margin-top: -5px;
          box-shadow: 0 0 8px rgba(29, 185, 84, 0.6);
          transition: transform 0.15s;
        }
        input[type='range']::-webkit-slider-thumb:hover { transform: scale(1.3); }
        input[type='range']::-moz-range-track { height: 4px; background: #333; border-radius: 2px; }
        input[type='range']::-moz-range-thumb { height: 14px; width: 14px; border: none; border-radius: 50%; background: #1db954; }
        button { -webkit-tap-highlight-color: transparent; touch-action: manipulation; font-family: inherit; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #222; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #333; }

        .layout { min-height: 100vh; }

        .container { max-width: 1200px; margin: 0 auto; padding: 24px 16px; }
        .title {
          font-size: 40px; font-weight: 900; margin: 0;
          background: linear-gradient(135deg, #1db954 0%, #1ed760 50%, #4ade80 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text; letter-spacing: 4px;
          text-transform: uppercase; text-align: center;
        }
        .tagline { color: #666; margin: 8px 0 0; font-size: 13px; letter-spacing: 1px; text-align: center; }
        .search-form { display: flex; gap: 10px; margin-bottom: 32px; }
        .search-input-wrap { flex: 1; position: relative; }
        .search-icon { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); font-size: 16px; color: #666; pointer-events: none; }
        .search-input {
          width: 100%; padding: 14px 16px 14px 44px; font-size: 16px;
          background: #1a1a24; border: 1px solid #2a2a35;
          border-radius: 12px; color: #fff; outline: none;
          transition: all 0.2s; -webkit-appearance: none;
        }
        .search-input:focus { border-color: #1db954; box-shadow: 0 0 0 3px rgba(29, 185, 84, 0.15); }
        .search-btn {
          padding: 14px 24px; font-size: 15px; font-weight: 600;
          cursor: pointer; border-radius: 12px;
          background: linear-gradient(135deg, #1db954, #1ed760);
          color: #000; border: none; transition: all 0.2s;
          box-shadow: 0 4px 20px rgba(29, 185, 84, 0.3);
          white-space: nowrap;
        }
        .search-btn:disabled { background: #333; box-shadow: none; cursor: wait; }

        .category-section { margin-bottom: 36px; }
        .category-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
        .category-title { font-size: 22px; font-weight: 700; margin: 0; color: #fff; letter-spacing: -0.3px; }
        .clear-btn {
          background: transparent; border: 1px solid #2a2a35;
          color: #888; padding: 6px 12px; border-radius: 8px;
          cursor: pointer; font-size: 11px; transition: all 0.15s;
        }
        .clear-btn:hover { color: #fff; border-color: #444; }

        .carousel {
          display: flex; gap: 14px; overflow-x: auto;
          scroll-snap-type: x mandatory; padding-bottom: 8px;
          -webkit-overflow-scrolling: touch; scrollbar-width: thin;
        }
        .carousel::-webkit-scrollbar { height: 6px; }
        .carousel::-webkit-scrollbar-thumb { background: #222; border-radius: 3px; }

        .card {
          flex: 0 0 auto; width: 160px; cursor: pointer;
          transition: transform 0.2s; scroll-snap-align: start;
          position: relative;
        }
        .card:hover { transform: translateY(-4px); }
        .card-thumb-wrap {
          width: 160px; height: 160px; border-radius: 10px;
          overflow: hidden; background: #1a1a24;
          box-shadow: 0 6px 20px rgba(0,0,0,0.4);
          display: flex; align-items: center; justify-content: center;
          font-size: 44px; color: #444; position: relative;
        }
        .card-thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
        .card-title {
          margin-top: 10px; font-size: 13px; font-weight: 600;
          color: #fff; overflow: hidden; text-overflow: ellipsis;
          white-space: nowrap;
        }
        .card-subtitle {
          margin-top: 3px; font-size: 11px; color: #888;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .card-like {
          position: absolute; bottom: 8px; right: 8px;
          width: 32px; height: 32px; border-radius: 50%;
          background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
          border: 1px solid rgba(255,255,255,0.1);
          color: #fff; font-size: 14px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          opacity: 0; transition: all 0.2s; z-index: 2;
        }
        .card:hover .card-like, .card-like.active { opacity: 1; }
        .card-like.active { color: #ff4b6b; background: rgba(255,75,107,0.15); border-color: rgba(255,75,107,0.4); }
        .card-like:hover { transform: scale(1.1); }
        .card-add {
          position: absolute; bottom: 8px; left: 8px;
          width: 32px; height: 32px; border-radius: 50%;
          background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
          border: 1px solid rgba(255,255,255,0.1);
          color: #fff; font-size: 18px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          opacity: 0; transition: all 0.2s; z-index: 2;
        }
        .card:hover .card-add { opacity: 1; }
        .card-add:hover { transform: scale(1.1); background: rgba(29,185,84,0.7); }

        .song-item {
          display: flex; align-items: center; gap: 12px;
          padding: 10px; margin-bottom: 6px; border-radius: 10px;
          cursor: pointer; transition: all 0.15s;
          border: 1px solid transparent;
        }
        .song-item:hover { background: #1a1a24; }
        .song-item.active { background: rgba(29, 185, 84, 0.15); border-color: rgba(29, 185, 84, 0.4); }
        .song-thumb-wrap {
          width: 52px; height: 52px; border-radius: 8px;
          overflow: hidden; background: #1a1a24; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          font-size: 22px; color: #444;
        }
        .song-thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
        .song-info { flex: 1; min-width: 0; }
        .song-title {
          font-weight: 600; font-size: 14px; color: #fff;
          overflow: hidden; text-overflow: ellipsis;
          white-space: nowrap; margin-bottom: 3px;
        }
        .song-item.active .song-title { color: #1ed760; }
        .song-artist {
          font-size: 12px; color: #888; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap;
        }
        .song-duration { font-size: 12px; color: #666; flex-shrink: 0; }
        .song-like { background: transparent; border: none; color: #555; font-size: 18px; cursor: pointer; padding: 8px; transition: all 0.15s; flex-shrink: 0; }
        .song-like:hover { color: #ff4b6b; transform: scale(1.15); }
        .song-like.active { color: #ff4b6b; }
        .song-add { background: transparent; border: none; color: #555; font-size: 20px; cursor: pointer; padding: 8px; transition: all 0.15s; flex-shrink: 0; }
        .song-add:hover { color: #1db954; transform: scale(1.15); }

        .player-bar {
          position: fixed; bottom: 0; left: 0; right: 0;
          background: rgba(15, 15, 20, 0.98);
          backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
          border-top: 1px solid #222; z-index: 100;
          box-shadow: 0 -8px 32px rgba(0,0,0,0.6);
          padding: 10px 16px;
          padding-bottom: calc(10px + env(safe-area-inset-bottom));
          cursor: pointer;
        }
        .player-inner { max-width: 1200px; margin: 0 auto; display: flex; align-items: center; gap: 12px; }
        .player-song { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
        .player-thumb-wrap {
          width: 44px; height: 44px; border-radius: 6px;
          overflow: hidden; background: #1a1a24; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          font-size: 20px; color: #444;
        }
        .player-thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
        .player-meta { min-width: 0; flex: 1; }
        .player-title { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 2px; }
        .player-artist { font-size: 11px; color: #888; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .player-controls { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
        .ctrl-btn {
          background: transparent; color: #fff; border: none;
          font-size: 18px; cursor: pointer;
          width: 40px; height: 40px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          transition: background 0.15s; padding: 0;
        }
        .ctrl-btn:hover { background: #222; }
        .play-btn {
          background: #fff; color: #000; border: none;
          border-radius: 50%; width: 42px; height: 42px;
          font-size: 15px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; transition: transform 0.15s; padding: 0;
        }
        .play-btn:hover { transform: scale(1.06); }
        .player-progress { flex: 1; display: flex; align-items: center; gap: 10px; min-width: 0; }
        .time-label { font-size: 11px; color: #888; min-width: 34px; text-align: center; flex-shrink: 0; }
        .player-volume { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .sleep-badge { font-size: 11px; color: #1db954; background: rgba(29,185,84,0.15); padding: 4px 10px; border-radius: 12px; font-weight: 600; }

        .bottom-nav {
          position: fixed; bottom: 0; left: 0; right: 0;
          background: rgba(10, 10, 15, 0.98);
          backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
          border-top: 1px solid #1a1a24;
          z-index: 99;
          display: flex; align-items: stretch;
          padding-bottom: env(safe-area-inset-bottom);
        }
        .nav-item {
          flex: 1;
          padding: 10px 8px 8px;
          background: transparent; border: none; color: #666;
          cursor: pointer;
          display: flex; flex-direction: column; align-items: center; gap: 3px;
          transition: color 0.15s; font-size: 10px; font-weight: 600;
          letter-spacing: 0.3px;
          position: relative;
        }
        .nav-item.active { color: #fff; }
        .nav-item:hover { color: #aaa; }
        .nav-icon { font-size: 22px; line-height: 1; transition: transform 0.15s; }
        .nav-item.active .nav-icon { transform: scale(1.1); }
        .nav-dot {
          width: 4px; height: 4px; border-radius: 50%;
          background: #1db954;
          position: absolute; bottom: 4px;
          opacity: 0; transition: opacity 0.2s;
        }
        .nav-item.active .nav-dot { opacity: 1; }

        .full-player {
          position: fixed; inset: 0; z-index: 999;
          display: flex; flex-direction: column;
          animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          overflow: hidden;
        }
        @keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .full-player-bg {
          position: absolute; inset: -10%;
          background-size: cover; background-position: center;
          filter: blur(80px) saturate(1.8);
          transform: scale(1.3); z-index: -2; opacity: 0.7;
        }
        .full-player-overlay {
          position: absolute; inset: 0;
          background:
            radial-gradient(ellipse at top, rgba(0,0,0,0.3) 0%, rgba(10,10,15,0.85) 60%),
            linear-gradient(180deg, rgba(10,10,15,0.5) 0%, rgba(10,10,15,0.98) 100%);
          z-index: -1;
        }
        .full-player-top {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 20px;
          padding-top: calc(16px + env(safe-area-inset-top));
          flex-shrink: 0;
        }
        .close-btn {
          background: rgba(255,255,255,0.08);
          backdrop-filter: blur(10px);
          color: #fff;
          border: 1px solid rgba(255,255,255,0.1);
          width: 42px; height: 42px; border-radius: 50%;
          font-size: 22px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.2s;
        }
        .close-btn:hover { background: rgba(255,255,255,0.15); transform: scale(1.05); }
        .top-btn {
          background: rgba(255,255,255,0.08);
          backdrop-filter: blur(10px);
          color: #fff;
          border: 1px solid rgba(255,255,255,0.1);
          width: 42px; height: 42px; border-radius: 50%;
          font-size: 18px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.2s;
        }
        .top-btn:hover { background: rgba(255,255,255,0.15); }
        .top-btn.active { color: #1db954; border-color: rgba(29,185,84,0.4); }
        .top-btns { display: flex; gap: 8px; }

        .full-player-label {
          display: flex; align-items: center; gap: 8px;
          font-size: 11px; font-weight: 600; letter-spacing: 2px;
          text-transform: uppercase; color: rgba(255,255,255,0.7);
        }
        .label-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: #1db954;
          box-shadow: 0 0 12px #1db954;
          animation: pulse 1.5s ease-in-out infinite;
        }
        @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.8); } }
        .full-player-content {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          padding: 20px 24px;
          padding-bottom: calc(30px + env(safe-area-inset-bottom));
          gap: 20px;
          max-width: 500px; margin: 0 auto; width: 100%;
        }
        .full-art-wrap { position: relative; width: min(65vw, 320px); height: min(65vw, 320px); flex-shrink: 0; }
        .full-art {
          width: 100%; height: 100%; border-radius: 20px;
          background-size: cover; background-position: center;
          background-color: #1a1a24;
          box-shadow: 0 30px 60px rgba(0,0,0,0.6), 0 10px 20px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.05);
          transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative; z-index: 1;
        }
        .full-art.playing { animation: breathe 4s ease-in-out infinite; }
        @keyframes breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.02); } }
        .full-art-fallback {
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
          font-size: 80px; color: #333; background: #1a1a24;
          border-radius: 20px; z-index: 1;
        }
        .visualizer-wrap { width: 100%; height: 60px; margin-top: 4px; position: relative; }
        .visualizer-canvas { width: 100%; height: 100%; display: block; }
        .full-info { text-align: center; width: 100%; padding: 0 10px; }
        .full-title {
          font-size: 22px; font-weight: 700; margin: 0 0 6px;
          color: #fff; letter-spacing: -0.3px;
          overflow: hidden; text-overflow: ellipsis;
          display: -webkit-box; -webkit-line-clamp: 2;
          -webkit-box-orient: vertical; line-height: 1.3;
        }
        .full-artist { font-size: 14px; color: rgba(255,255,255,0.6); margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .full-progress-wrap { width: 100%; display: flex; flex-direction: column; gap: 6px; }
        .full-progress { width: 100% !important; height: 6px !important; }
        .full-time {
          display: flex; justify-content: space-between;
          font-size: 11px; color: rgba(255,255,255,0.5);
          font-variant-numeric: tabular-nums; letter-spacing: 0.5px;
        }
        .full-controls { display: flex; align-items: center; justify-content: center; gap: 20px; margin-top: 4px; width: 100%; }
        .full-ctrl {
          background: transparent; border: none; color: #fff;
          cursor: pointer; padding: 8px; transition: all 0.2s;
          display: flex; align-items: center; justify-content: center;
        }
        .full-ctrl.side { font-size: 30px; color: rgba(255,255,255,0.85); }
        .full-ctrl.side:hover { color: #fff; transform: scale(1.1); }
        .full-ctrl.small { font-size: 20px; color: rgba(255,255,255,0.6); }
        .full-ctrl.small:hover { color: #fff; }
        .full-ctrl.small.active { color: #1db954; }
        .full-play {
          background: #fff; color: #000; border: none;
          width: 72px; height: 72px; border-radius: 50%;
          font-size: 26px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.2s;
          box-shadow: 0 10px 30px rgba(255,255,255,0.15), 0 0 0 1px rgba(255,255,255,0.1);
        }
        .full-play:hover {
          transform: scale(1.06);
          box-shadow: 0 15px 40px rgba(255,255,255,0.2), 0 0 0 1px rgba(255,255,255,0.15);
        }
        .full-play:active { transform: scale(0.98); }
        .full-like-btn {
          background: transparent; border: none;
          color: rgba(255,255,255,0.6); font-size: 26px;
          cursor: pointer; padding: 8px; transition: all 0.2s;
          display: flex; align-items: center; justify-content: center;
        }
        .full-like-btn:hover { transform: scale(1.15); color: #ff4b6b; }
        .full-like-btn.active { color: #ff4b6b; }
        .full-volume { display: flex; align-items: center; gap: 12px; width: 100%; max-width: 300px; }
        .vol-icon { font-size: 16px; color: rgba(255,255,255,0.5); flex-shrink: 0; }
        .full-vol-slider { flex: 1; }

        .lyrics-panel {
          position: absolute; inset: 0;
          background: rgba(10,10,15,0.95);
          backdrop-filter: blur(20px);
          z-index: 5;
          display: flex; flex-direction: column;
          animation: fadeIn 0.3s ease;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .lyrics-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 20px;
          padding-top: calc(16px + env(safe-area-inset-top));
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .lyrics-title { font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 2px; color: rgba(255,255,255,0.7); }
        .lyrics-body {
          flex: 1; overflow-y: auto;
          padding: 30vh 32px 40vh;
          white-space: pre-wrap; text-align: center; scroll-behavior: smooth;
        }
        .lyrics-body.plain {
          font-size: 18px; line-height: 1.8;
          color: rgba(255,255,255,0.85);
          padding: 24px 32px 100px; font-weight: 500;
        }
        .lyrics-empty {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          color: rgba(255,255,255,0.4);
          gap: 12px; font-size: 14px;
        }
        .lyrics-empty-icon { font-size: 48px; opacity: 0.4; }

        .lyric-line {
          padding: 12px 16px; margin: 6px 0;
          font-size: 20px; font-weight: 600; line-height: 1.5;
          color: rgba(255,255,255,0.25);
          transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
          cursor: pointer; border-radius: 10px;
          text-align: center; transform-origin: center;
          user-select: none;
        }
        .lyric-line:hover { color: rgba(255,255,255,0.6); background: rgba(255,255,255,0.03); }
        .lyric-line.active {
          color: #1ed760; font-size: 26px; font-weight: 800;
          text-shadow: 0 0 40px rgba(29,185,84,0.5);
          transform: scale(1.03);
        }
        .lyric-line.passed { color: rgba(255,255,255,0.12); }

        .queue-panel {
          position: absolute; inset: 0;
          background: rgba(10,10,15,0.95);
          backdrop-filter: blur(20px);
          z-index: 5;
          display: flex; flex-direction: column;
          animation: fadeIn 0.3s ease;
        }
        .queue-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 20px;
          padding-top: calc(16px + env(safe-area-inset-top));
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .queue-title { font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 2px; color: rgba(255,255,255,0.7); }
        .queue-list { flex: 1; overflow-y: auto; padding: 8px 12px 100px; }
        .queue-item {
          display: flex; align-items: center; gap: 12px;
          padding: 10px; border-radius: 10px;
          cursor: pointer; transition: background 0.15s;
        }
        .queue-item:hover { background: rgba(255,255,255,0.05); }
        .queue-item.active { background: rgba(29,185,84,0.15); }
        .queue-item-thumb { width: 42px; height: 42px; border-radius: 6px; object-fit: cover; flex-shrink: 0; background: #1a1a24; }
        .queue-item-info { flex: 1; min-width: 0; }
        .queue-item-title { font-size: 13px; font-weight: 600; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 2px; }
        .queue-item.active .queue-item-title { color: #1ed760; }
        .queue-item-artist { font-size: 11px; color: #888; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .queue-remove { background: transparent; border: none; color: #666; font-size: 18px; cursor: pointer; padding: 8px; transition: color 0.15s; }
        .queue-remove:hover { color: #ff4b6b; }
        .queue-index { font-size: 12px; color: #666; min-width: 20px; text-align: center; }

        .sleep-menu {
          position: absolute;
          top: 70px; right: 20px;
          background: rgba(20,20,28,0.98);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px; padding: 8px;
          min-width: 160px; z-index: 10;
          box-shadow: 0 10px 40px rgba(0,0,0,0.6);
          animation: fadeIn 0.2s ease;
        }
        .sleep-option {
          display: block; width: 100%;
          padding: 10px 14px;
          background: transparent; border: none;
          color: #fff; text-align: left;
          cursor: pointer; border-radius: 8px;
          font-size: 13px; transition: background 0.15s;
        }
        .sleep-option:hover { background: rgba(255,255,255,0.08); }
        .sleep-option.active { color: #1db954; }

        .tab-content { padding-bottom: 160px; }
        .tab-content.no-player { padding-bottom: 80px; }

        /* ===== DESKTOP SIDEBAR ===== */
        .sidebar { display: none; }

        @media (max-width: 768px) {
          .container { padding: 16px 12px; }
          .title { font-size: 32px; letter-spacing: 3px; }
          .tagline { font-size: 12px; }
          .category-title { font-size: 18px; }
          .card { width: 130px; }
          .card-thumb-wrap { width: 130px; height: 130px; font-size: 36px; }
          .card-title { font-size: 12px; }
          .card-subtitle { font-size: 10px; }
          .song-thumb-wrap { width: 48px; height: 48px; font-size: 20px; }
          .song-title { font-size: 13px; }
          .song-artist { font-size: 11px; }
          .song-duration { font-size: 11px; }
          .song-add { padding: 6px; font-size: 18px; }
          .song-like { padding: 6px; font-size: 16px; }

          .player-bar {
            padding: 10px 12px;
            bottom: 60px;
          }
          .player-inner { flex-wrap: wrap; gap: 8px; }
          .player-song { flex: 1; min-width: 0; order: 1; }
          .player-controls { order: 3; width: 100%; justify-content: center; gap: 12px; }
          .player-progress { order: 2; width: 100%; flex-basis: 100%; margin: 0; }
          .player-volume { display: none; }
          .ctrl-btn { width: 44px; height: 44px; font-size: 20px; }
          .play-btn { width: 48px; height: 48px; font-size: 18px; }
          .player-thumb-wrap { width: 40px; height: 40px; font-size: 18px; }
          .player-title { font-size: 12px; }
          .player-artist { font-size: 10px; }
          .time-label { font-size: 10px; min-width: 30px; }

          .full-title { font-size: 20px; }
          .full-artist { font-size: 13px; }
          .full-controls { gap: 12px; }
          .full-play { width: 68px; height: 68px; font-size: 24px; }
          .full-ctrl.side { font-size: 26px; }
          .full-ctrl.small { font-size: 18px; }
          .full-player-content { gap: 16px; padding: 16px 20px 30px; }
          .lyrics-body { padding: 25vh 20px 40vh; }
          .lyric-line { font-size: 17px; padding: 10px 12px; }
          .lyric-line.active { font-size: 21px; }
        }

        @media (max-width: 380px) {
          .title { font-size: 26px; }
          .tagline { font-size: 11px; }
          .card { width: 115px; }
          .card-thumb-wrap { width: 115px; height: 115px; font-size: 32px; }
          .full-art-wrap { width: min(75vw, 280px); height: min(75vw, 280px); }
          .full-title { font-size: 18px; }
          .full-play { width: 64px; height: 64px; font-size: 22px; }
        }

        @media (min-width: 769px) {
          .layout {
            display: grid;
            grid-template-columns: 240px 1fr;
            min-height: 100vh;
          }
          .sidebar {
            display: flex;
            flex-direction: column;
            padding: 24px 12px;
            background: #0d0d14;
            border-right: 1px solid #1a1a24;
            position: sticky;
            top: 0;
            height: 100vh;
            overflow-y: auto;
          }
          .sidebar-logo {
            font-size: 22px;
            font-weight: 900;
            letter-spacing: 3px;
            text-transform: uppercase;
            background: linear-gradient(135deg, #1db954 0%, #1ed760 50%, #4ade80 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            padding: 8px 12px;
            margin-bottom: 24px;
          }
          .sidebar-nav { display: flex; flex-direction: column; gap: 4px; }
          .sidebar-btn {
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 12px 14px;
            background: transparent;
            border: none;
            color: #888;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            border-radius: 8px;
            transition: all 0.15s;
            text-align: left;
            width: 100%;
          }
          .sidebar-btn:hover { color: #fff; background: rgba(255,255,255,0.04); }
          .sidebar-btn.active { color: #fff; background: rgba(29,185,84,0.12); }
          .sidebar-btn.active .sidebar-icon { color: #1db954; }
          .sidebar-icon { font-size: 20px; line-height: 1; flex-shrink: 0; }
          .sidebar-section-title {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            color: #555;
            padding: 20px 14px 8px;
          }
          .bottom-nav { display: none !important; }
          .player-bar { left: 240px; bottom: 0 !important; padding-bottom: 14px; }
          .container { max-width: 1400px; }
          .tab-content { padding-bottom: 130px; }
          .tab-content.no-player { padding-bottom: 24px; }
        }

        @media (min-width: 1025px) {
          .container { padding: 40px 24px; }
          .title { font-size: 48px; }
          .category-title { font-size: 24px; }
          .card { width: 180px; }
          .card-thumb-wrap { width: 180px; height: 180px; font-size: 48px; }
          .card-title { font-size: 14px; }
          .card-subtitle { font-size: 12px; }
          .search-input { padding: 16px 18px 16px 52px; font-size: 16px; }
          .search-btn { padding: 16px 32px; font-size: 16px; }
          .song-thumb-wrap { width: 56px; height: 56px; font-size: 24px; }
          .song-item { padding: 12px; }
          .song-title { font-size: 15px; }
          .song-artist { font-size: 13px; }
          .player-thumb-wrap { width: 48px; height: 48px; font-size: 22px; }
          .player-title { font-size: 14px; }
          .player-artist { font-size: 12px; }
        }
      `}</style>

      <main style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #0a0a0f 0%, #12121a 100%)' }}>
        <div className="layout">
          {/* ✅ DESKTOP SIDEBAR */}
          <aside className="sidebar">
            <div className="sidebar-logo">YAZVORA</div>
            <nav className="sidebar-nav">
              <button className={`sidebar-btn ${tab === 'home' ? 'active' : ''}`} onClick={() => setTab('home')}>
                <span className="sidebar-icon">🏠</span>
                <span>Home</span>
              </button>
              <button className={`sidebar-btn ${tab === 'search' ? 'active' : ''}`} onClick={() => setTab('search')}>
                <span className="sidebar-icon">🔍</span>
                <span>Search</span>
              </button>
              <button className={`sidebar-btn ${tab === 'library' ? 'active' : ''}`} onClick={() => setTab('library')}>
                <span className="sidebar-icon">📚</span>
                <span>Library</span>
              </button>
            </nav>
            {liked.length > 0 && (
              <>
                <div className="sidebar-section-title">Liked ({liked.length})</div>
                <div style={{ padding: '0 4px', maxHeight: '300px', overflowY: 'auto' }}>
                  {liked.slice(0, 10).map((song, i) => (
                    <button
                      key={`side-liked-${i}-${song.id}`}
                      className="sidebar-btn"
                      style={{ fontSize: '12px', padding: '8px 12px', gap: '10px' }}
                      onClick={() => playSong(song)}
                      title={song.title}
                    >
                      <span className="sidebar-icon" style={{ fontSize: '12px', opacity: 0.6 }}>♪</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                        {song.title}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {recent.length > 0 && (
              <>
                <div className="sidebar-section-title">Recent</div>
                <div style={{ padding: '0 4px', maxHeight: '240px', overflowY: 'auto' }}>
                  {recent.slice(0, 8).map((song, i) => (
                    <button
                      key={`side-recent-${i}-${song.id}`}
                      className="sidebar-btn"
                      style={{ fontSize: '12px', padding: '8px 12px', gap: '10px' }}
                      onClick={() => playSong(song)}
                      title={song.title}
                    >
                      <span className="sidebar-icon" style={{ fontSize: '12px', opacity: 0.4 }}>⏱</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                        {song.title}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </aside>

          {/* MAIN CONTENT */}
          <div className={`container tab-content ${currentSong ? '' : 'no-player'}`}>
            {/* Header (mobile only, PC pe sidebar mein logo hai) */}
            <div style={{ marginBottom: '24px' }}>
              <h1 className="title">YAZVORA</h1>
              <p className="tagline">Unlimited Beats, Zero Fees. 🎵</p>
            </div>

            {/* SEARCH BAR (only on search tab) */}
            {tab === 'search' && (
              <form onSubmit={searchSongs} className="search-form">
                <div className="search-input-wrap">
                  <span className="search-icon">🔍</span>
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Kya sunna hai aaj?"
                    className="search-input"
                    autoFocus
                  />
                </div>
                <button type="submit" disabled={loading} className="search-btn">
                  {loading ? '⏳' : 'Search'}
                </button>
              </form>
            )}

            {/* HOME TAB */}
            {tab === 'home' && (
              <div>
                {catLoading && (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: '#666' }}>
                    <div style={{ fontSize: '28px', marginBottom: '10px' }}>🎧</div>
                    <p>Loading music...</p>
                  </div>
                )}

                {!catLoading && liked.length > 0 && (
                  <div className="category-section">
                    <h2 className="category-title">❤️ Liked Songs</h2>
                    <div className="carousel">
                      {liked.map((item, i) => (
                        <div key={`liked-${i}-${item.id}`} className="card" onClick={() => playSong(item)}>
                          <div className="card-thumb-wrap">
                            {item.thumbnail ? (
                              <img src={proxyImg(item.thumbnail)} alt={item.title} className="card-thumb" loading="lazy"
                                onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '🎵'; }} />
                            ) : ('🎵')}
                            <button className="card-like active" onClick={(e) => toggleLike(item, e)}>♥</button>
                          </div>
                          <div className="card-title">{item.title}</div>
                          <div className="card-subtitle">{item.artist}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!catLoading && recent.length > 0 && (
                  <div className="category-section">
                    <div className="category-header">
                      <h2 className="category-title">🕐 Recently Played</h2>
                      <button onClick={clearHistory} className="clear-btn">Clear</button>
                    </div>
                    <div className="carousel">
                      {recent.map((item, i) => (
                        <div key={`recent-${i}-${item.id}`} className="card" onClick={() => playSong(item)}>
                          <div className="card-thumb-wrap">
                            {item.thumbnail ? (
                              <img src={proxyImg(item.thumbnail)} alt={item.title} className="card-thumb" loading="lazy"
                                onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '🎵'; }} />
                            ) : ('🎵')}
                            <button className={`card-like ${isLiked(item.id) ? 'active' : ''}`} onClick={(e) => toggleLike(item, e)}>
                              {isLiked(item.id) ? '♥' : '♡'}
                            </button>
                          </div>
                          <div className="card-title">{item.title}</div>
                          <div className="card-subtitle">{item.artist}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!catLoading && categories.map((cat, ci) => (
                  <div key={ci} className="category-section">
                    <h2 className="category-title">{cat.title}</h2>
                    <div className="carousel">
                      {cat.items.map((item, ii) => (
                        <div key={`${ci}-${ii}-${item.id}`} className="card" onClick={() => handleCardClick(item)}>
                          <div className="card-thumb-wrap">
                            {item.thumbnail ? (
                              <img src={proxyImg(item.thumbnail)} alt={item.title} className="card-thumb" loading="lazy"
                                onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '🎵'; }} />
                            ) : ('🎵')}
                            {item.type === 'song' && (
                              <>
                                <button className="card-add" onClick={(e) => addToQueue(item, e)}>+</button>
                                <button className={`card-like ${isLiked(item.id) ? 'active' : ''}`} onClick={(e) => toggleLike(item, e)}>
                                  {isLiked(item.id) ? '♥' : '♡'}
                                </button>
                              </>
                            )}
                          </div>
                          <div className="card-title">{item.title}</div>
                          <div className="card-subtitle">{item.subtitle}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {!catLoading && categories.length === 0 && recent.length === 0 && liked.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '60px 20px', color: '#666' }}>
                    <div style={{ fontSize: '56px', marginBottom: '16px', opacity: 0.5 }}>🎵</div>
                    <p style={{ fontSize: '16px', margin: 0 }}>Search tab pe jao aur kuch dhundho</p>
                    <p style={{ fontSize: '13px', marginTop: '8px' }}>Try: "Kesariya", "Arijit Singh", "Lofi"</p>
                  </div>
                )}
              </div>
            )}

            {/* SEARCH TAB */}
            {tab === 'search' && (
              <div>
                {!searched && !loading && (
                  <div style={{ textAlign: 'center', padding: '60px 20px', color: '#666' }}>
                    <div style={{ fontSize: '56px', marginBottom: '16px', opacity: 0.5 }}>🔍</div>
                    <p style={{ fontSize: '16px', margin: 0 }}>Kya sunna hai aaj?</p>
                    <p style={{ fontSize: '13px', marginTop: '8px' }}>Try: "Kesariya", "Arijit Singh", "Lofi"</p>
                  </div>
                )}

                {loading && (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: '#666' }}>
                    <div style={{ fontSize: '32px', marginBottom: '12px' }}>🎧</div>
                    <p>Searching...</p>
                  </div>
                )}

                {!loading && searched && songs.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: '#666' }}>
                    <div style={{ fontSize: '48px', marginBottom: '12px' }}>😕</div>
                    <p>Koi gaana nahi mila</p>
                  </div>
                )}

                {songs.map((song, i) => {
                  const isActive = currentSong?.id === song.id;
                  const likedSong = isLiked(song.id);
                  return (
                    <div key={song.id} onClick={() => playSong(song)} className={`song-item ${isActive ? 'active' : ''}`}>
                      <div className="song-thumb-wrap">
                        {song.thumbnail ? (
                          <img src={proxyImg(song.thumbnail)} alt={song.title} className="song-thumb"
                            onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '🎵'; }} />
                        ) : ('🎵')}
                      </div>
                      <div className="song-info">
                        <div className="song-title">{song.title}</div>
                        <div className="song-artist">{song.artist}</div>
                      </div>
                      <div className="song-duration">{song.duration}</div>
                      <button className="song-add" onClick={(e) => addToQueue(song, e)}>+</button>
                      <button className={`song-like ${likedSong ? 'active' : ''}`} onClick={(e) => toggleLike(song, e)}>
                        {likedSong ? '♥' : '♡'}
                      </button>
                    </div>
                  );
                })}

                {!loading && songs.length > 0 && (
                  <button onClick={() => { setSongs([]); setQuery(''); setSearched(false); }}
                    style={{
                      marginTop: '20px', padding: '10px 20px',
                      background: '#1a1a24', color: '#fff',
                      border: '1px solid #2a2a35', borderRadius: '8px',
                      cursor: 'pointer', fontSize: '14px',
                    }}>
                    ✕ Clear search
                  </button>
                )}
              </div>
            )}

            {/* LIBRARY TAB */}
            {tab === 'library' && (
              <div>
                {liked.length > 0 && (
                  <div className="category-section">
                    <h2 className="category-title">❤️ Liked Songs ({liked.length})</h2>
                    {liked.map((song, i) => {
                      const isActive = currentSong?.id === song.id;
                      return (
                        <div key={`lib-liked-${i}-${song.id}`} onClick={() => playSong(song)}
                          className={`song-item ${isActive ? 'active' : ''}`}>
                          <div className="song-thumb-wrap">
                            {song.thumbnail ? (
                              <img src={proxyImg(song.thumbnail)} alt={song.title} className="song-thumb"
                                onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '🎵'; }} />
                            ) : ('🎵')}
                          </div>
                          <div className="song-info">
                            <div className="song-title">{song.title}</div>
                            <div className="song-artist">{song.artist}</div>
                          </div>
                          <button className="song-like active" onClick={(e) => toggleLike(song, e)}>♥</button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {recent.length > 0 && (
                  <div className="category-section">
                    <div className="category-header">
                      <h2 className="category-title">🕐 Recently Played</h2>
                      <button onClick={clearHistory} className="clear-btn">Clear</button>
                    </div>
                    {recent.map((song, i) => {
                      const isActive = currentSong?.id === song.id;
                      return (
                        <div key={`lib-recent-${i}-${song.id}`} onClick={() => playSong(song)}
                          className={`song-item ${isActive ? 'active' : ''}`}>
                          <div className="song-thumb-wrap">
                            {song.thumbnail ? (
                              <img src={proxyImg(song.thumbnail)} alt={song.title} className="song-thumb"
                                onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '🎵'; }} />
                            ) : ('🎵')}
                          </div>
                          <div className="song-info">
                            <div className="song-title">{song.title}</div>
                            <div className="song-artist">{song.artist}</div>
                          </div>
                          <button className={`song-like ${isLiked(song.id) ? 'active' : ''}`}
                            onClick={(e) => toggleLike(song, e)}>
                            {isLiked(song.id) ? '♥' : '♡'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {liked.length === 0 && recent.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '60px 20px', color: '#666' }}>
                    <div style={{ fontSize: '56px', marginBottom: '16px', opacity: 0.5 }}>📚</div>
                    <p style={{ fontSize: '16px', margin: 0 }}>Library khaali hai</p>
                    <p style={{ fontSize: '13px', marginTop: '8px' }}>Songs like karo aur suno!</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* BOTTOM NAV (mobile only) */}
        {!fullPlayer && (
          <div className="bottom-nav">
            <button className={`nav-item ${tab === 'home' ? 'active' : ''}`} onClick={() => setTab('home')}>
              <span className="nav-icon">🏠</span>
              <span>Home</span>
              <span className="nav-dot" />
            </button>
            <button className={`nav-item ${tab === 'search' ? 'active' : ''}`} onClick={() => setTab('search')}>
              <span className="nav-icon">🔍</span>
              <span>Search</span>
              <span className="nav-dot" />
            </button>
            <button className={`nav-item ${tab === 'library' ? 'active' : ''}`} onClick={() => setTab('library')}>
              <span className="nav-icon">📚</span>
              <span>Library</span>
              <span className="nav-dot" />
            </button>
          </div>
        )}

        {/* PLAYER BAR */}
        {currentSong && !fullPlayer && (
          <div className="player-bar" onClick={() => setFullPlayer(true)}>
            <div className="player-inner">
              <div className="player-song">
                <div className="player-thumb-wrap">
                  {currentSong.thumbnail ? (
                    <img src={proxyImg(currentSong.thumbnail)} alt={currentSong.title} className="player-thumb"
                      onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '🎵'; }} />
                  ) : ('🎵')}
                </div>
                <div className="player-meta">
                  <div className="player-title">{currentSong.title}</div>
                  <div className="player-artist">{currentSong.artist}</div>
                </div>
                {sleepMinutes > 0 && <span className="sleep-badge">😴 {sleepMinutes}m</span>}
              </div>

              <div className="player-controls" onClick={(e) => e.stopPropagation()}>
                <button onClick={playPrev} className="ctrl-btn">⏮</button>
                <button onClick={togglePlay} className="play-btn">
                  {buffering ? '⏳' : isPlaying ? '⏸' : '▶'}
                </button>
                <button onClick={playNext} className="ctrl-btn">⏭</button>
              </div>

              <div className="player-progress">
                <span className="time-label">{formatTime(progress)}</span>
                <input type="range" min="0" max={duration || 0} value={progress} onChange={handleSeek}
                  onClick={(e) => e.stopPropagation()} style={{ flex: 1, minWidth: 0 }} />
                <span className="time-label">{formatTime(duration)}</span>
              </div>

              <div className="player-volume" onClick={(e) => e.stopPropagation()}>
                <span style={{ fontSize: '14px', color: '#888' }}>🔊</span>
                <input type="range" min="0" max="1" step="0.01" value={volume} onChange={handleVolume}
                  style={{ width: '80px' }} />
              </div>
            </div>
          </div>
        )}

        {/* FULL PLAYER */}
        {currentSong && fullPlayer && (
          <div className="full-player">
            <div className="full-player-bg" style={{ backgroundImage: currentSong.thumbnail ? `url(${proxyImg(currentSong.thumbnail)})` : 'none' }} />
            <div className="full-player-overlay" />

            {showLyrics && (
              <div className="lyrics-panel">
                <div className="lyrics-header">
                  <div className="lyrics-title">Lyrics {timedLyrics.length > 0 && '• Synced'}</div>
                  <button className="close-btn" onClick={() => setShowLyrics(false)}>⌄</button>
                </div>
                {lyricsLoading ? (
                  <div className="lyrics-empty">
                    <div className="lyrics-empty-icon">⏳</div>
                    <p>Lyrics load ho rahi hain...</p>
                  </div>
                ) : timedLyrics.length > 0 ? (
                  <div className="lyrics-body" ref={lyricsContainerRef}>
                    {timedLyrics.map((line, i) => (
                      <div key={i} ref={(el) => (lyricLineRefs.current[i] = el)}
                        className={`lyric-line ${i === activeLyric ? 'active' : i < activeLyric ? 'passed' : ''}`}
                        onClick={() => { if (audioRef.current) audioRef.current.currentTime = line.time; }}>
                        {line.text}
                      </div>
                    ))}
                  </div>
                ) : lyrics ? (
                  <div className="lyrics-body plain">{lyrics}</div>
                ) : (
                  <div className="lyrics-empty">
                    <div className="lyrics-empty-icon">🎤</div>
                    <p>Is gaane ki lyrics nahi mili</p>
                  </div>
                )}
              </div>
            )}

            {showQueue && (
              <div className="queue-panel">
                <div className="queue-header">
                  <div className="queue-title">Queue ({queue.length})</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="close-btn" onClick={clearQueue}
                      style={{ width: 36, height: 36, fontSize: 14 }}>🗑</button>
                    <button className="close-btn" onClick={() => setShowQueue(false)}>⌄</button>
                  </div>
                </div>
                <div className="queue-list">
                  {queue.map((song, i) => (
                    <div key={`q-${i}-${song.id}`} className={`queue-item ${i === currentIndex ? 'active' : ''}`}
                      onClick={() => playSong(song)}>
                      <span className="queue-index">{i + 1}</span>
                      {song.thumbnail && (
                        <img src={proxyImg(song.thumbnail)} alt={song.title} className="queue-item-thumb"
                          onError={(e) => (e.target.style.visibility = 'hidden')} />
                      )}
                      <div className="queue-item-info">
                        <div className="queue-item-title">{song.title}</div>
                        <div className="queue-item-artist">{song.artist}</div>
                      </div>
                      <button className="queue-remove" onClick={(e) => removeFromQueue(i, e)}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="full-player-top">
              <button className="close-btn" onClick={() => setFullPlayer(false)}>⌄</button>
              <div className="full-player-label">
                <span className="label-dot" />
                Now Playing
              </div>
              <div className="top-btns">
                <button className={`top-btn ${showLyrics ? 'active' : ''}`}
                  onClick={() => { setShowLyrics(!showLyrics); setShowQueue(false); }}>🎤</button>
                <button className={`top-btn ${showQueue ? 'active' : ''}`}
                  onClick={() => { setShowQueue(!showQueue); setShowLyrics(false); }}>📜</button>
                <button className={`top-btn ${sleepMinutes > 0 ? 'active' : ''}`}
                  onClick={() => setShowSleepMenu(!showSleepMenu)}>😴</button>
              </div>
            </div>

            {showSleepMenu && (
              <div className="sleep-menu">
                <button className={`sleep-option ${sleepMinutes === 15 ? 'active' : ''}`} onClick={() => setSleepTimer(15)}>15 minutes</button>
                <button className={`sleep-option ${sleepMinutes === 30 ? 'active' : ''}`} onClick={() => setSleepTimer(30)}>30 minutes</button>
                <button className={`sleep-option ${sleepMinutes === 60 ? 'active' : ''}`} onClick={() => setSleepTimer(60)}>60 minutes</button>
                {sleepMinutes > 0 && (
                  <button className="sleep-option" onClick={() => setSleepTimer(0)} style={{ color: '#ff4b6b' }}>
                    Turn Off ({sleepMinutes}m left)
                  </button>
                )}
              </div>
            )}

            <div className="full-player-content">
              <div className="full-art-wrap">
                <div className={`full-art ${isPlaying ? 'playing' : ''}`}
                  style={{ backgroundImage: currentSong.thumbnail ? `url(${proxyImg(currentSong.thumbnail)})` : 'none' }} />
                {!currentSong.thumbnail && <div className="full-art-fallback">🎵</div>}
              </div>

              <div className="full-info">
                <h2 className="full-title">{currentSong.title}</h2>
                <p className="full-artist">{currentSong.artist}</p>
              </div>

              <div className="visualizer-wrap">
                <canvas ref={canvasRef} className="visualizer-canvas" width={500} height={60} />
              </div>

              <div className="full-progress-wrap">
                <input type="range" min="0" max={duration || 0} value={progress}
                  onChange={handleSeek} className="full-progress" />
                <div className="full-time">
                  <span>{formatTime(progress)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              <div className="full-controls">
                <button className={`full-ctrl small ${shuffle ? 'active' : ''}`} onClick={() => setShuffle(!shuffle)}>🔀</button>
                <button onClick={playPrev} className="full-ctrl side">⏮</button>
                <button onClick={togglePlay} className="full-play">
                  {buffering ? '⏳' : isPlaying ? '⏸' : '▶'}
                </button>
                <button onClick={playNext} className="full-ctrl side">⏭</button>
                <button className={`full-ctrl small ${repeatActive ? 'active' : ''}`} onClick={cycleRepeat}>
                  {repeat === 'one' ? '🔂' : '🔁'}
                </button>
              </div>

              <div className="full-volume">
                <button className={`full-like-btn ${isLiked(currentSong.id) ? 'active' : ''}`}
                  onClick={(e) => toggleLike(currentSong, e)}>
                  {isLiked(currentSong.id) ? '♥' : '♡'}
                </button>
                <span className="vol-icon">🔊</span>
                <input type="range" min="0" max="1" step="0.01" value={volume}
                  onChange={handleVolume} className="full-vol-slider" />
              </div>
            </div>
          </div>
        )}

        <audio ref={audioRef} crossOrigin="anonymous"
          onTimeUpdate={() => {
            if (audioRef.current) {
              const t = audioRef.current.currentTime;
              setProgress(t);
              syncLyrics(t);
            }
          }}
          onLoadedMetadata={() => audioRef.current && setDuration(audioRef.current.duration)}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => setBuffering(false)}
          onEnded={() => { setIsPlaying(false); playNext(true); }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      </main>
    </>
  );
}