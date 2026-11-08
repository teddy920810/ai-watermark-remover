import { useRef, useState } from 'react';
import { Maximize, Pause, Play, Volume2, VolumeX } from 'lucide-react';

export function GeminiVideoCompare({ original, result, mobileView }: { original: string; result: string; mobileView: string }) {
  const source = useRef<HTMLVideoElement>(null); const output = useRef<HTMLVideoElement>(null); const stage = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false); const [muted, setMuted] = useState(false); const [time, setTime] = useState(0); const [duration, setDuration] = useState(0); const [error, setError] = useState('');
  const stamp = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  function pause() { source.current?.pause(); output.current?.pause(); setPlaying(false); }
  async function toggle() {
    if (playing) { pause(); return; }
    if (!source.current || !output.current) return;
    source.current.currentTime = output.current.currentTime;
    try { await Promise.all([source.current.play(), output.current.play()]); setPlaying(true); } catch { pause(); setError('Playback could not start. Try downloading the video.'); }
  }
  function seek(next: number) { if (source.current) source.current.currentTime = next; if (output.current) output.current.currentTime = next; setTime(next); }
  return <div ref={stage} className="gemini-video-stage">
    <div className={`gemini-comparison mobile-${mobileView}`}>
      <figure className="gemini-original"><figcaption>Original</figcaption><video ref={source} src={original} muted playsInline preload="metadata" /></figure>
      <figure className="gemini-result"><figcaption>Result</figcaption><video ref={output} src={result} muted={muted} playsInline preload="metadata" onLoadedMetadata={event => setDuration(event.currentTarget.duration)} onEnded={pause} onError={() => setError('The preview could not open. Your download is still available.')} onTimeUpdate={event => { const value = event.currentTarget.currentTime; setTime(value); if (source.current && Math.abs(source.current.currentTime - value) > 0.2) source.current.currentTime = value; }} /></figure>
    </div>
    <div className="gemini-video-controls">
      <button type="button" aria-label={playing ? 'Pause comparison' : 'Play comparison'} onClick={() => void toggle()}>{playing ? <Pause size={19} /> : <Play size={19} />}</button>
      <span>{stamp(time)} / {stamp(duration)}</span>
      <input aria-label="Video position" type="range" min={0} max={duration || 1} step="0.01" value={time} onChange={event => seek(Number(event.target.value))} />
      <button type="button" aria-label={muted ? 'Unmute video' : 'Mute video'} onClick={() => setMuted(!muted)}>{muted ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
      <button type="button" aria-label="Fullscreen comparison" onClick={() => void stage.current?.requestFullscreen?.().catch(() => setError('Fullscreen is unavailable in this browser.'))}><Maximize size={19} /></button>
    </div>
    {error && <p role="status">{error}</p>}
  </div>;
}
