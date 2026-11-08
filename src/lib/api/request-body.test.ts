import { describe, expect, it, vi } from 'vitest';
import { readBoundedBody, RequestBodyLimitError } from './request-body';

describe('bounded request bytes', () => {
  it('preserves exact bytes across chunks, including split UTF-8 and BOM', async () => {
    const bytes = new TextEncoder().encode('\uFEFF{"text":"中文😀"}');
    const stream = new ReadableStream<Uint8Array>({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); } });
    expect(await readBoundedBody(stream, bytes.length)).toEqual(bytes);
    expect(stream.locked).toBe(false);
    expect(await readBoundedBody(null, 1)).toEqual(new Uint8Array());
  });
  it('cancels immediately on overflow without requesting another chunk and releases the lock', async () => {
    const cancel = vi.fn(), pull = vi.fn(() => { throw new Error('Must not read another chunk'); });
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(9)); }, pull, cancel }, { highWaterMark: 0 });
    await expect(readBoundedBody(stream, 8)).rejects.toBeInstanceOf(RequestBodyLimitError);
    expect(cancel).toHaveBeenCalledOnce(); expect(pull).not.toHaveBeenCalled(); expect(stream.locked).toBe(false);
  });
  it('counts the complete streamed body rather than accepting individually small chunks', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(4)); c.enqueue(new Uint8Array(5)); c.close(); } });
    await expect(readBoundedBody(stream, 8)).rejects.toBeInstanceOf(RequestBodyLimitError);
    expect(stream.locked).toBe(false);
  });
  it('does not let a cancellation failure mask the body limit', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(9)); }, cancel() { throw new Error('private transport failure'); } });
    await expect(readBoundedBody(stream, 8)).rejects.toBeInstanceOf(RequestBodyLimitError);
    expect(stream.locked).toBe(false);
  });
  it('propagates a read interruption while releasing the lock', async () => {
    const error = new Error('read interrupted');
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.error(error); } });
    await expect(readBoundedBody(stream, 8)).rejects.toBe(error); expect(stream.locked).toBe(false);
  });
  it.each([0, -1, NaN, Infinity])('rejects an invalid byte limit before taking a reader (%s)', async limit => {
    const stream = new ReadableStream<Uint8Array>();
    await expect(readBoundedBody(stream, limit)).rejects.toBeInstanceOf(RangeError); expect(stream.locked).toBe(false);
  });
});
