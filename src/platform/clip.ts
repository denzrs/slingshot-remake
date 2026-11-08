/** Records the canvas while a killcam replays and hands back a video file to download or share. */

const TYPES: [mime: string, ext: string][] = [
  ['video/mp4;codecs=avc1', 'mp4'],
  ['video/webm;codecs=vp9', 'webm'],
  ['video/webm;codecs=vp8', 'webm'],
  ['video/webm', 'webm'],
  ['video/mp4', 'mp4'],
];

function pickType(): [string, string] | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return TYPES.find(([mime]) => MediaRecorder.isTypeSupported(mime)) ?? null;
}

/** A finished recording: the video as a file, named by when it was made. */
export interface Clip {
  file: File;
}

/** How a share ended: the sheet took it, the player closed the sheet, or the browser could not share it. */
export type ShareResult = 'shared' | 'cancelled' | 'failed';

export function clipName(date: Date, ext: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `slingshot-killcam-${stamp}.${ext}`;
}

/** Whether this browser's share sheet takes the clip as a file (phones and tablets mostly). */
export function canShareClip(clip: Clip, nav: Pick<Navigator, 'canShare' | 'share'> | undefined = globalThis.navigator): boolean {
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    return nav.canShare({ files: [clip.file] });
  } catch {
    return false;
  }
}

/**
 * Open the share sheet with the clip. It must be called straight from a tap: the browser only opens the sheet while
 * the tap is still fresh, so nothing may be awaited before it.
 */
export async function shareClip(clip: Clip, nav: Pick<Navigator, 'share'> | undefined = globalThis.navigator): Promise<ShareResult> {
  if (!nav || typeof nav.share !== 'function') return 'failed';
  try {
    await nav.share({ files: [clip.file], title: 'Slingshot' });
    return 'shared';
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

/** Save the clip through the browser's download. */
export function downloadClip(clip: Clip): void {
  const url = URL.createObjectURL(clip.file);
  const a = document.createElement('a');
  a.href = url;
  a.download = clip.file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export class ClipRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private type: [string, string] | null = pickType();

  static get supported(): boolean {
    return pickType() !== null && 'captureStream' in HTMLCanvasElement.prototype;
  }

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  start(canvas: HTMLCanvasElement): boolean {
    if (!this.type || this.recording) return false;
    const stream = canvas.captureStream(60);
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: this.type[0], videoBitsPerSecond: 8_000_000 });
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(250);
    return true;
  }

  /** Stop recording and hand back the clip, or null when nothing was being recorded. */
  async stop(): Promise<Clip | null> {
    const rec = this.recorder;
    if (!rec || rec.state === 'inactive' || !this.type) return null;
    const [mime, ext] = this.type;
    const done = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
    rec.stop();
    rec.stream.getTracks().forEach((t) => t.stop());
    await done;
    this.recorder = null;
    return { file: new File(this.chunks, clipName(new Date(), ext), { type: mime.split(';')[0] }) };
  }
}
