import { useEffect, useMemo, useRef, useState } from 'react';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useMessages } from '../i18n';
import { loadAssets } from '../preview/assets';
import { drawFilmFrame, FILM_HEIGHT, FILM_WIDTH, type Film, loadFilm } from '../preview/film';
import { BPM, type Music, moodFor, playMusic } from '../preview/music';
import { FILM_BITS_PER_SECOND, type Recording, startRecording, VIDEO_BITS_PER_SECOND } from '../preview/recording';
import { type Assets, buildStory, drawFrame, HEIGHT, WIDTH } from '../preview/story';
import { keepVideo, recordedVideo, videoKey } from '../preview/videoCache';
import type { Outfit } from '../types/outfit';
import type { StoryInput } from '../types/preview';
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
  /** The same Google Maps link as the result's directions button. */
  directions: string | null;
  onClose: () => void;
}

export function WalkPreview({ input, outfit, directions, onClose }: WalkPreviewProps) {
  const { preview: text, result: resultText } = useMessages();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const avatarRef = useRef<HTMLDivElement>(null);
  const assetsRef = useRef<Assets | null>(null);
  const filmRef = useRef<Film | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const runRef = useRef<Run | null>(null);
  const mutedRef = useRef(false);
  const still = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const key = useMemo(() => videoKey(input, outfit, still), [input, outfit, still]);
  // Read once: a preview recorded in this same open stays live, so Replay keeps redrawing it.
  const [recorded] = useState(() => recordedVideo(key));
  const [phase, setPhase] = useState<Phase>(recorded ? 'playing' : 'loading');
  const [hasFilm, setHasFilm] = useState(false);
  const [muted, setMuted] = useState(false);
  const [video, setVideo] = useState<Video | null>(null);

  const mood = moodFor(input.conditions.sky, input.conditions.isDay);
  const story = useMemo(() => buildStory(input, BPM[mood]), [input, mood]);
  const canShare = video !== null && navigator.canShare?.({ files: [video.file] }) === true;
  const canvasWidth = hasFilm ? FILM_WIDTH : WIDTH;
  const canvasHeight = hasFilm ? FILM_HEIGHT : HEIGHT;

  async function playRecorded() {
    const element = videoRef.current;
    if (!element) return;
    element.currentTime = 0;
    try {
      await element.play();
      setPhase('playing');
    } catch {
      setPhase('blocked');
    }
  }

  const start = () => void (recorded ? playRecorded() : play());

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
    const draw = (t: number) =>
      film ? drawFilmFrame(context2d, film, t, still) : drawFrame(context2d, story, t, assets!, still);

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

    const recording = startRecording(
      canvas,
      tape.stream,
      film ? FILM_BITS_PER_SECOND : VIDEO_BITS_PER_SECOND,
      (file) => {
        keepVideo(key, file);
        setVideo({ url: URL.createObjectURL(file), file });
      },
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: the preview plays once per open; later changes to the result don't restart it.
  useEffect(() => {
    const player = videoRef.current;
    if (recorded && player) {
      // Set here rather than as a prop: React setting the same src again would restart the video.
      const url = URL.createObjectURL(recorded);
      player.src = url;
      setVideo({ url, file: recorded });
      void playRecorded();
      return () => player.pause();
    }
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
  }, []);

  useEffect(() => {
    mutedRef.current = muted;
    if (runRef.current) runRef.current.speakers.gain.value = muted ? 0 : 1;
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  useEffect(
    () => () => {
      if (video) URL.revokeObjectURL(video.url);
    },
    [video],
  );

  useEscapeKey(onClose);

  async function share() {
    if (!video) return;
    try {
      await navigator.share({ files: [video.file], title: text.shareTitle(input.placeName) });
    } catch {
      // The person closed the share sheet.
    }
  }

  return (
    <div
      className="preview-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={text.dialog(Boolean(input.bikeStation), input.placeName)}
    >
      <div className="preview-stage">
        {recorded ? (
          // biome-ignore lint/a11y/useMediaCaption: the only sound is instrumental music; every word is drawn into the frames.
          <video ref={videoRef} className="preview-canvas" playsInline onEnded={() => setPhase('done')} />
        ) : (
          <canvas ref={canvasRef} className="preview-canvas" width={canvasWidth} height={canvasHeight} />
        )}
        <div ref={avatarRef} hidden>
          <Avatar outfit={outfit} />
        </div>
        <div className="preview-controls">
          <button
            type="button"
            className="preview-icon"
            onClick={() => setMuted(!muted)}
            aria-pressed={muted}
            aria-label={text.mute}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <button type="button" className="preview-icon" onClick={onClose} aria-label={text.close} autoFocus>
            ✕
          </button>
        </div>
        {phase === 'loading' && (
          <p className="preview-status shimmer" role="status">
            {text.loading}
          </p>
        )}
        {phase === 'error' && <p className="preview-status">{text.error}</p>}
        {phase === 'blocked' && (
          <button type="button" className="preview-play" onClick={start}>
            {text.play}
          </button>
        )}
        {phase === 'done' && (
          <div className="preview-actions">
            {directions && (
              <a className="primary" href={directions} target="_blank" rel="noreferrer">
                {resultText.directions(Boolean(input.bikeStation), input.placeName)}
              </a>
            )}
            <div className="preview-row">
              <button type="button" className="secondary" onClick={start}>
                {text.replay}
              </button>
              {video && (
                <a className="secondary" href={video.url} download={video.file.name}>
                  {text.save}
                </a>
              )}
              {canShare && (
                <button type="button" className="secondary" onClick={() => void share()}>
                  {text.share}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
