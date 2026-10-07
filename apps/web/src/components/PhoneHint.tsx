import { useCallback, useEffect, useRef, useState } from 'react';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useMessages } from '../i18n';
import { isOnThisComputer } from '../utils/host';

const SETUP_URL = 'https://github.com/scs0209/touch-grass-agent#use-it-on-your-phone';

/** Tells people on the Mac how to take the app outside, since a phone can only reach Gemma through Tailscale. */
export function PhoneHint() {
  const t = useMessages().phone;
  const [open, setOpen] = useState(false);
  const openRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    openRef.current?.focus();
  }, []);
  useEscapeKey(close, open);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!isOnThisComputer(window.location.hostname)) return null;

  return (
    <>
      <button ref={openRef} className="link" onClick={() => setOpen(true)} type="button">
        {t.link}
      </button>
      {open && (
        <div className="dialog-backdrop">
          <div className="panel phone-hint" role="dialog" aria-modal="true" aria-labelledby="phone-hint-title">
            <div className="phone-hint-header">
              <h2 id="phone-hint-title">{t.title}</h2>
              <button ref={closeRef} className="phone-hint-close" onClick={close} aria-label={t.close} type="button">
                ×
              </button>
            </div>
            <p className="muted small">{t.body}</p>
            <ol className="small">
              <li>
                {t.installBefore}
                <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">
                  Tailscale
                </a>
                {t.installAfter}
              </li>
              <li>
                {t.runBefore}
                <code>pnpm phone</code>
                {t.runBetween}
                <code>tailscale serve --bg 4173</code>
                {t.runAfter}
              </li>
              <li>
                {t.openBefore}
                <code>https://….ts.net</code>
                {t.openAfter}
              </li>
            </ol>
            <a className="link small" href={SETUP_URL} target="_blank" rel="noreferrer">
              {t.fullSteps}
            </a>
          </div>
        </div>
      )}
    </>
  );
}
