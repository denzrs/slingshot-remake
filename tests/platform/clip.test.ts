import { describe, expect, it, vi } from 'vitest';
import { canShareClip, clipName, shareClip } from '../../src/platform/clip';

const clip = { file: new File([new Uint8Array(4)], 'x.mp4', { type: 'video/mp4' }) };

describe('clipName', () => {
  it('stamps the clip with the date and the minute', () => {
    expect(clipName(new Date(2026, 10, 8, 9, 5), 'mp4')).toBe('slingshot-killcam-20261108-0905.mp4');
  });
});

describe('canShareClip', () => {
  it('needs a share sheet that takes files', () => {
    expect(canShareClip(clip, undefined)).toBe(false);
    expect(canShareClip(clip, {} as Navigator)).toBe(false);
    expect(canShareClip(clip, { share: vi.fn(), canShare: () => false })).toBe(false);
    expect(canShareClip(clip, { share: vi.fn(), canShare: () => true })).toBe(true);
  });
  it('treats a throwing canShare as no', () => {
    const nav = { share: vi.fn(), canShare: () => { throw new TypeError('x'); } };
    expect(canShareClip(clip, nav)).toBe(false);
  });
});

describe('shareClip', () => {
  it('hands the file to the sheet', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await shareClip(clip, { share })).toBe('shared');
    expect(share.mock.calls[0][0].files).toEqual([clip.file]);
  });
  it('tells a closed sheet from a failure, so only a failure falls back to a download', async () => {
    expect(await shareClip(clip, { share: () => Promise.reject(new DOMException('x', 'AbortError')) })).toBe('cancelled');
    expect(await shareClip(clip, { share: () => Promise.reject(new DOMException('x', 'NotAllowedError')) })).toBe('failed');
    expect(await shareClip(clip, undefined)).toBe('failed');
  });
});
