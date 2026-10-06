import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from './Avatar';
import { directionsUrl } from './directions';
import type { Outfit } from './OutfitCards';
import { buildStory, drawFrame, HEIGHT, imagePaths, WIDTH, type Assets, type StoryInput } from './previewDraw';
import { BPM, moodFor, playMusic, type Music } from './previewMusic';

type Phase = 'loading' | 'blocked' | 'playing' | 'done' | 'error';

interface Recording {
  finish(): void;
  discard(): void;
}

interface Run {
  frame: number;
  music: Music;
  recording: Recording | null;
  speakers: GainNode;
}

interface Video {
  url: string;
  file: File;
}

const FRAME_RATE = 30;
/** Keeps a 30-second clip under about 10 MB so messaging apps accept it. */
const VIDEO_BITS_PER_SECOND = 2_500_000;
/** Safari records MP4 only; Chrome and Firefox record WebM. */
const VIDEO_TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
/** How long to wait for the browser to allow sound before asking for a tap. */
const AUTOPLAY_WAIT_MS = 300;

function loadImage(src: string) {
  const image = new Image();
  image.src = src;
  return image.decode().then(() => image);
}

async function loadAssets(input: StoryInput, avatarMarkup: string): Promise<Assets> {
  const svg = avatarMarkup.replace(
    '<svg ',
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="660" ',
  );
  const paths = imagePaths(input);
  const [avatar, ...images] = await Promise.all([
    loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`),
    ...paths.map(loadImage),
  ]);
  return { avatar, images: new Map(paths.map((path, i) => [path, images[i]])) };
}

/** Records the canvas with the music; only a recording that played to the end is kept. */
function startRecording(canvas: HTMLCanvasElement, audio: MediaStream, onVideo: (file: File) => void): Recording | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const type = VIDEO_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!type) return null;

  const stream = canvas.captureStream(FRAME_RATE);
  audio.getAudioTracks().forEach((track) => stream.addTrack(track));
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
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

interface WalkPreviewProps {
  input: StoryInput;
  outfit: Outfit;
  onClose: () => void;
}

export function WalkPreview({ input, outfit, onClose }: WalkPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const avatarRef = useRef<HTMLDivElement>(null);
  const assetsRef = useRef<Assets | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const runRef = useRef<Run | null>(null);
  const mutedRef = useRef(false);
  const [phase, setPhase] = useState<Phase>('loading');
  const [muted, setMuted] = useState(false);
  const [video, setVideo] = useState<Video | null>(null);

  const mood = moodFor(input.conditions.sky, input.conditions.isDay);
  const story = useMemo(() => buildStory(input, BPM[mood]), [input, mood]);
  const still = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const canShare = video !== null && navigator.canShare?.({ files: [video.file] }) === true;

  function stopRun() {
    const run = runRef.current;
    if (!run) return;
    cancelAnimationFrame(run.frame);
    run.music.stop();
    run.recording?.discard();
    runRef.current = null;
  }

  async function play() {
    const canvas = canvasRef.current;
    const assets = assetsRef.current;
    const context2d = canvas?.getContext('2d');
    if (!canvas || !assets || !context2d) return;
    stopRun();

    const audio = (audioRef.current ??= new AudioContext());
    if (audio.state !== 'running') {
      await Promise.race([audio.resume(), new Promise((resolve) => setTimeout(resolve, AUTOPLAY_WAIT_MS))]);
    }
    if (audio.state !== 'running') {
      drawFrame(context2d, story, 0, assets, still);
      setPhase('blocked');
      return;
    }

    const speakers = audio.createGain();
    speakers.gain.value = mutedRef.current ? 0 : 1;
    speakers.connect(audio.destination);
    const tape = audio.createMediaStreamDestination();
    const startAt = audio.currentTime + 0.15;
    const music = playMusic(audio, mood, startAt, story.total, [speakers, tape]);

    const recording = startRecording(canvas, tape.stream, (file) => setVideo({ url: URL.createObjectURL(file), file }));
    const run: Run = { frame: 0, music, recording, speakers };
    runRef.current = run;
    setPhase('playing');

    const tick = () => {
      const t = Math.max(audio.currentTime - startAt, 0);
      drawFrame(context2d, story, Math.min(t, story.total), assets, still);
      if (t < story.total) {
        run.frame = requestAnimationFrame(tick);
        return;
      }
      recording?.finish();
      runRef.current = null;
      setPhase('done');
    };
    run.frame = requestAnimationFrame(tick);
  }

  useEffect(() => {
    let cancelled = false;
    loadAssets(input, avatarRef.current?.innerHTML ?? '')
      .then((assets) => {
        if (cancelled) return;
        assetsRef.current = assets;
        void play();
      })
      .catch(() => {
        if (!cancelled) setPhase('error');
      });
    return () => {
      cancelled = true;
      stopRun();
      void audioRef.current?.close();
      audioRef.current = null;
    };
    // The preview plays once per open; later changes to the result don't restart it.
  }, []);

  useEffect(() => {
    mutedRef.current = muted;
    if (runRef.current) runRef.current.speakers.gain.value = muted ? 0 : 1;
  }, [muted]);

  useEffect(() => () => {
    if (video) URL.revokeObjectURL(video.url);
  }, [video]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function share() {
    if (!video) return;
    try {
      await navigator.share({ files: [video.file], title: `My walk to ${input.placeName}` });
    } catch {
      // The person closed the share sheet.
    }
  }

  return (
    <div className="preview-backdrop" role="dialog" aria-modal="true" aria-label={`Preview of your ${input.bikeStation ? 'ride' : 'walk'} to ${input.placeName}`}>
      <div className="preview-stage">
        <canvas ref={canvasRef} className="preview-canvas" width={WIDTH} height={HEIGHT} />
        <div ref={avatarRef} hidden>
          <Avatar outfit={outfit} />
        </div>
        <div className="preview-controls">
          <button className="preview-icon" onClick={() => setMuted(!muted)} aria-pressed={muted} aria-label="Mute music">
            {muted ? '🔇' : '🔊'}
          </button>
          <button className="preview-icon" onClick={onClose} aria-label="Close preview" autoFocus>
            ✕
          </button>
        </div>
        {phase === 'loading' && <p className="preview-status">Getting your walk ready…</p>}
        {phase === 'error' && <p className="preview-status">Couldn't load the preview.</p>}
        {phase === 'blocked' && (
          <button className="preview-play" onClick={() => void play()}>
            ▶ Play with music
          </button>
        )}
        {phase === 'done' && (
          <div className="preview-actions">
            <a
              className="primary"
              href={directionsUrl(input.destination, input.bikeStation)}
              target="_blank"
              rel="noreferrer"
            >
              {input.bikeStation ? 'Ride' : 'Walk'} to {input.placeName}
            </a>
            <div className="preview-row">
              <button className="secondary" onClick={() => void play()}>
                Replay
              </button>
              {video && (
                <a className="secondary" href={video.url} download={video.file.name}>
                  Save video
                </a>
              )}
              {canShare && (
                <button className="secondary" onClick={() => void share()}>
                  Share
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
