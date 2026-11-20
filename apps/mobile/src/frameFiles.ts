/**
 * Camera frames are written to the cache as files. Scene assist takes a couple
 * of them every second and nothing ever removed them, so an hour in a pocket
 * left thousands of photos behind. These helpers delete a frame once nothing
 * needs it any more. Deleting is best-effort: a missing file system module or
 * an already-removed file is not an error.
 */
type FileSystemModule = typeof import('expo-file-system');
let fileSystem: FileSystemModule | null = null;

try {
  fileSystem = require('expo-file-system') as FileSystemModule;
} catch {
  fileSystem = null;
}

export function discardFile(uri: string | null | undefined) {
  if (!uri || !uri.startsWith('file:') || !fileSystem?.File) return;
  try {
    const file = new fileSystem.File(uri);
    if (file.exists) file.delete();
  } catch {
    /* best-effort */
  }
}

/** Remembers recent frames and deletes each one after it has had time to be uploaded. */
export class FrameJanitor {
  private frames: { uri: string; at: number }[] = [];

  constructor(private readonly keepMs = 20000) {}

  track(uri: string, now = Date.now()) {
    this.frames.push({ uri, at: now });
    this.sweep(now);
  }

  sweep(now = Date.now()) {
    // Always keep the newest frame: the assistant may still borrow it.
    while (this.frames.length > 1 && now - this.frames[0].at > this.keepMs) {
      discardFile(this.frames.shift()?.uri);
    }
  }

  clear() {
    for (const frame of this.frames) discardFile(frame.uri);
    this.frames = [];
  }
}
