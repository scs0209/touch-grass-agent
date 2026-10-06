import { useEffect, useMemo, useRef, useState } from 'react';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { loadAssets } from '../preview/assets';
import { drawFilmFrame, FILM_HEIGHT, FILM_WIDTH, loadFilm, type Film } from '../preview/film';
import { BPM, moodFor, playMusic, type Music } from '../preview/music';
import { FILM_BITS_PER_SECOND, startRecording, VIDEO_BITS_PER_SECOND, type Recording } from '../preview/recording';
import { buildStory, drawFrame, HEIGHT, WIDTH, type Assets } from '../preview/story';
import type { Outfit } from '../types/outfit';
import type { StoryInput } from '../types/preview';
import { directionsUrl } from '../utils/directions';
import { Avatar } from './Avatar';

type Phase = 'loading' | 'blocked' | 'playing' | 'done' | 'error';

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

/** How long to wait for the browser to allow sound before asking for a tap. */
const AUTOPLAY_WAIT_MS = 300;

interface WalkPreviewProps {
  input: StoryInput;
  outfit: Outfit;
  onClose: () => void;
}

export function WalkPreview({ input, outfit, onClose }: WalkPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const avatarRef = useRef<HTMLDivElement>(null);
  const assetsRef = useRef<Assets | null>(null);
  const filmRef = useRef<Film | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const runRef = useRef<Run | null>(null);
  const mutedRef = useRef(false);
  const [phase, setPhase] = useState<Phase>('loading');
  const [hasFilm, setHasFilm] = useState(false);
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
    const film = filmRef.current;
    const context2d = canvas?.getContext('2d');
    if (!canvas || !context2d || (!film && !assets)) return;
    stopRun();

    // React sets the same size on the next render; the first frames can't wait for it.
    canvas.width = film ? FILM_WIDTH : WIDTH;
    canvas.height = film ? FILM_HEIGHT : HEIGHT;
    const total = film ? film.total : story.total;
    const draw = (t: number) => (film ? drawFilmFrame(context2d, film, t, still) : drawFrame(context2d, story, t, assets!, still));

    const audio = (audioRef.current ??= new AudioContext());
    if (audio.state !== 'running') {
      await Promise.race([audio.resume(), new Promise((resolve) => setTimeout(resolve, AUTOPLAY_WAIT_MS))]);
    }
    if (audio.state !== 'running') {
      draw(0);
      setPhase('blocked');
      return;
    }

    const speakers = audio.createGain();
    speakers.gain.value = mutedRef.current ? 0 : 1;
    speakers.connect(audio.destination);
    const tape = audio.createMediaStreamDestination();
    const startAt = audio.currentTime + 0.15;
    const music = playMusic(audio, mood, startAt, total, [speakers, tape]);

    const recording = startRecording(canvas, tape.stream, film ? FILM_BITS_PER_SECOND : VIDEO_BITS_PER_SECOND, (file) =>
      setVideo({ url: URL.createObjectURL(file), file }),
    );
    const run: Run = { frame: 0, music, recording, speakers };
    runRef.current = run;
    setPhase('playing');

    const tick = () => {
      const t = Math.max(audio.currentTime - startAt, 0);
      draw(Math.min(t, total));
      if (t < total) {
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
    const abort = new AbortController();
    // The 3D flyover when the map loads; otherwise the illustrated story.
    loadFilm(input, BPM[mood], abort.signal)
      .catch(() => null)
      .then(async (film) => {
        if (cancelled) {
          film?.dispose();
          return;
        }
        if (film) {
          filmRef.current = film;
          setHasFilm(true);
        } else {
          assetsRef.current = await loadAssets(input, avatarRef.current?.innerHTML ?? '');
        }
        if (!cancelled) void play();
      })
      .catch(() => {
        if (!cancelled) setPhase('error');
      });
    return () => {
      cancelled = true;
      abort.abort();
      stopRun();
      filmRef.current?.dispose();
      filmRef.current = null;
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

  useEscapeKey(onClose);

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
        <canvas
          ref={canvasRef}
          className="preview-canvas"
          width={hasFilm ? FILM_WIDTH : WIDTH}
          height={hasFilm ? FILM_HEIGHT : HEIGHT}
        />
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
        {phase === 'loading' && (
          <p className="preview-status shimmer" role="status">
            Getting your walk ready…
          </p>
        )}
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
