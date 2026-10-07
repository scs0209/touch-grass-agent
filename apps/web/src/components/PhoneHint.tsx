import { useCallback, useEffect, useRef, useState } from 'react';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { isOnThisComputer } from '../utils/host';

const SETUP_URL = 'https://github.com/scs0209/touch-grass-agent#use-it-on-your-phone';

/** Tells people on the Mac how to take the app outside, since a phone can only reach Gemma through Tailscale. */
export function PhoneHint() {
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
        Use it on your phone
      </button>
      {open && (
        <div className="dialog-backdrop">
          <div className="panel phone-hint" role="dialog" aria-modal="true" aria-labelledby="phone-hint-title">
            <div className="phone-hint-header">
              <h2 id="phone-hint-title">Take it outside</h2>
              <button ref={closeRef} className="phone-hint-close" onClick={close} aria-label="Close" type="button">
                ×
              </button>
            </div>
            <p className="muted small">
              Gemma runs on this computer. To use the app on your phone outside, connect the two with Tailscale, which
              is free for personal use. Checking in works on the phone even without a signal.
            </p>
            <ol className="small">
              <li>
                Install{' '}
                <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">
                  Tailscale
                </a>{' '}
                on this computer and your phone, signed in to the same account.
              </li>
              <li>
                Run <code>pnpm phone</code>, then <code>tailscale serve --bg 4173</code>.
              </li>
              <li>
                Open the <code>https://….ts.net</code> address it prints on your phone.
              </li>
            </ol>
            <a className="link small" href={SETUP_URL} target="_blank" rel="noreferrer">
              Full setup steps
            </a>
          </div>
        </div>
      )}
    </>
  );
}
