import type { Outfit } from '../types/outfit';
import type { StoryInput } from '../types/preview';

/** About 12 MB each (30 seconds at 3.2 Mbps), held in memory for this visit only. */
const MAX_VIDEOS = 3;

const videos = new Map<string, File>();

/**
 * Everything a preview is drawn from. Its clock times come from the result, not from when it plays, so the
 * same key always means the same video.
 */
export const videoKey = (input: StoryInput, outfit: Outfit, still: boolean) => JSON.stringify({ input, outfit, still });

/** A video recorded earlier from the same key, so opening the preview again plays it instead of rebuilding it. */
export function recordedVideo(key: string): File | null {
  const file = videos.get(key);
  if (!file) return null;
  videos.delete(key);
  videos.set(key, file);
  return file;
}

export function keepVideo(key: string, file: File) {
  videos.delete(key);
  videos.set(key, file);
  while (videos.size > MAX_VIDEOS) videos.delete(videos.keys().next().value as string);
}
