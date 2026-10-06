export interface Recording {
  finish(): void;
  discard(): void;
}

const FRAME_RATE = 30;
/** Keeps a 30-second clip under about 10 MB so messaging apps accept it. */
export const VIDEO_BITS_PER_SECOND = 2_500_000;
/** The full-size flyover needs more bits; still keeps a 37-second film under WhatsApp's 16 MB media limit. */
export const FILM_BITS_PER_SECOND = 3_200_000;
/** Safari records MP4 only; Chrome and Firefox record WebM. */
const VIDEO_TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];

/** Records the canvas with the music; only a recording that played to the end is kept. */
export function startRecording(
  canvas: HTMLCanvasElement,
  audio: MediaStream,
  bitsPerSecond: number,
  onVideo: (file: File) => void,
): Recording | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const type = VIDEO_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!type) return null;

  const stream = canvas.captureStream(FRAME_RATE);
  audio.getAudioTracks().forEach((track) => stream.addTrack(track));
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: bitsPerSecond });
  const chunks: Blob[] = [];
  let keep = false;
  recorder.ondataavailable = (event) => chunks.push(event.data);
  recorder.onstop = () => {
    stream.getTracks().forEach((track) => track.stop());
    if (!keep) return;
    const extension = type.startsWith('video/mp4') ? 'mp4' : 'webm';
    onVideo(new File(chunks, `touch-grass-walk.${extension}`, { type: type.split(';')[0] }));
  };
  recorder.start();

  const stop = (save: boolean) => {
    keep = save;
    if (recorder.state === 'recording') recorder.stop();
  };
  return { finish: () => stop(true), discard: () => stop(false) };
}
