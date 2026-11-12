import { Input, BlobSource, ALL_FORMATS, Mp4OutputFormat, canEncodeVideo } from 'mediabunny';
import { inspectGeminiVideoFile, removeGeminiVideoWatermark, removeWatermarkFromImageDataSync } from '../../vendor/gemini/engine.js';
import type { LocalMediaInfo } from './free-gemini';
import { localOperationCatalog } from '../contracts/operation-catalog';

const scope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage(message: unknown): void };
scope.onmessage = async (event: MessageEvent<{ file: File; mode: 'inspect' | 'process' }>) => {
  const { file, mode } = event.data;
  try {
    let info: LocalMediaInfo;
    if (file.type === 'video/mp4') {
      if (typeof VideoDecoder === 'undefined' || typeof VideoEncoder === 'undefined') throw new Error('This browser cannot process video locally. Try a recent Chrome or Edge browser.');
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
      try {
        const video = await input.getPrimaryVideoTrack();
        if (!video || !await video.canDecode()) throw new Error('This browser cannot decode this video. Choose a compatible MP4.');
        const audio = await input.getPrimaryAudioTrack();
        const codec = audio ? await audio.getCodec() : null;
        if (audio && (!codec || !new Mp4OutputFormat().getSupportedAudioCodecs().includes(codec))) throw new Error('This video’s audio cannot be preserved. Choose another MP4.');
        const meta = await inspectGeminiVideoFile(file);
        if (!await canEncodeVideo('avc', { width: meta.width, height: meta.height, bitrate: 12_000_000 })) throw new Error('This browser cannot export this video as MP4.');
        info = { kind: 'video', width: meta.width, height: meta.height, durationSeconds: meta.duration, fps: meta.frameRate, rotation: await video.getRotation(), hasAudio: Boolean(audio) };
      } finally { input.dispose(); }
      if (mode === 'inspect') { scope.postMessage({ info }); return; }
      const result = await removeGeminiVideoWatermark(file, {
        onProgress: value => scope.postMessage({ stage: value.phase === 'detect' ? 'Detecting the watermark' : value.progress === 1 ? 'Generating your MP4' : 'Processing your video', progress: value.progress }),
        yieldToMainThread: () => new Promise(resolve => setTimeout(resolve, 0)),
      });
      if (info.hasAudio && !result.audioCopied) throw new Error('The audio could not be preserved. No silent result was saved.');
      scope.postMessage({ info: { ...info, hasAudio: result.audioCopied }, blob: result.blob });
    } else {
      const image = await createImageBitmap(file);
      try {
        if (image.width * image.height > localOperationCatalog['gemini-image-free'].capability.maxPixels) throw new Error('Choose an image smaller than 40 megapixels.');
        info = { kind: 'image', width: image.width, height: image.height };
        if (mode === 'inspect') { scope.postMessage({ info }); return; }
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('This browser cannot process images locally.');
        context.drawImage(image, 0, 0);
        scope.postMessage({ stage: 'Processing your image' });
        const result = removeWatermarkFromImageDataSync(context.getImageData(0, 0, image.width, image.height));
        if (!result.meta.applied) throw new Error('No supported Gemini watermark detected. Your original file is unchanged.');
        context.putImageData(new ImageData(result.imageData.data, image.width, image.height), 0, 0);
        scope.postMessage({ stage: 'Generating your PNG' });
        scope.postMessage({ info, blob: await canvas.convertToBlob({ type: 'image/png' }), bestEffort: result.meta.bestEffort });
      } finally { image.close(); }
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'This file could not be processed. Try another original Gemini file.';
    scope.postMessage({ error: /水印检测置信度偏低/.test(message) ? 'No supported Gemini watermark detected in this video. Your original file is unchanged.' : message });
  }
};
