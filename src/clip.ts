/** Records the canvas while a killcam replays and hands back a video file to download. */

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

  /** Stop and download the clip. */
  async stopAndSave(): Promise<void> {
    const rec = this.recorder;
    if (!rec || rec.state === 'inactive' || !this.type) return;
    const [mime, ext] = this.type;
    const done = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
    rec.stop();
    rec.stream.getTracks().forEach((t) => t.stop());
    await done;
    this.recorder = null;
    const blob = new Blob(this.chunks, { type: mime.split(';')[0] });
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `slingshot-killcam-${stamp}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
