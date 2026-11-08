import { Output, Mp4OutputFormat, BufferTarget, CanvasSource, Input, BlobSource, ALL_FORMATS, EncodedAudioPacketSource, EncodedPacketSink } from 'mediabunny';
import { getVideoAlphaMap } from '../../src/vendor/gemini/engine.js';

function decode(encoded: string) { return new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))]); }
function encode(bytes: Uint8Array) { let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(binary); }
export async function createGeminiVideo(audioFixture: string, fps = 24, marked = true) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(decode(audioFixture)) });
  try {
    const track = await input.getPrimaryAudioTrack(); if (!track) throw new Error('Audio fixture is missing');
    const codec = await track.getCodec(); if (!codec) throw new Error('Audio codec is missing');
    const target = new BufferTarget(); const output = new Output({ format: new Mp4OutputFormat(), target });
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720; const ctx = canvas.getContext('2d')!;
    const source = new CanvasSource(canvas, { codec: 'avc', bitrate: 12_000_000 }); output.addVideoTrack(source, { frameRate: fps });
    const audio = new EncodedAudioPacketSource(codec); output.addAudioTrack(audio); await output.start();
    const decoderConfig = await track.getDecoderConfig();
    for await (const packet of new EncodedPacketSink(track).packets()) if (packet.timestamp >= 0) await audio.add(packet, { decoderConfig: decoderConfig ?? undefined });
    audio.close(); const alpha = getVideoAlphaMap(48);
    for (let frame = 0; frame < fps * 2; frame++) {
      ctx.fillStyle = '#406080'; ctx.fillRect(0, 0, 1280, 720); ctx.fillStyle = '#7894a8'; ctx.fillRect(80 + frame * 2, 150, 200, 130);
      const region = ctx.getImageData(1160, 600, 48, 48);
      for (let i = 0; i < alpha.length; i++) for (let c = 0; c < 3; c++) region.data[i * 4 + c] = Math.round(Math.abs(alpha[i]) * 255 + (1 - Math.abs(alpha[i])) * region.data[i * 4 + c]);
      if (marked) ctx.putImageData(region, 1160, 600);
      await source.add(frame / fps, 1 / fps);
    }
    source.close(); await output.finalize(); if (!target.buffer) throw new Error('Empty video fixture');
    return encode(new Uint8Array(target.buffer));
  } finally { input.dispose(); }
}
export async function inspectGeminiResult(encoded: string) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(decode(encoded)) });
  try { const video = await input.getPrimaryVideoTrack(); if (!video) throw new Error('Result has no video'); return { width: await video.getDisplayWidth(), height: await video.getDisplayHeight(), duration: await input.computeDuration(), audio: Boolean(await input.getPrimaryAudioTrack()) }; } finally { input.dispose(); }
}
