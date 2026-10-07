import { useState } from 'react';
import { hidePhoneHint, isPhoneHintHidden } from '../services/phoneHintStorage';
import { isOnThisComputer } from '../utils/host';

const SETUP_URL = 'https://github.com/scs0209/touch-grass-agent#use-it-on-your-phone';

/** Tells people on the Mac how to take the app outside, since a phone can only reach Gemma through Tailscale. */
export function PhoneHint() {
  const [hidden, setHidden] = useState(() => !isOnThisComputer(window.location.hostname) || isPhoneHintHidden());
  if (hidden) return null;

  function hide() {
    hidePhoneHint();
    setHidden(true);
  }

  return (
    <section className="panel phone-hint" aria-labelledby="phone-hint-title">
      <div className="phone-hint-header">
        <h2 id="phone-hint-title">Take it outside</h2>
        <button className="phone-hint-close" onClick={hide} aria-label="Hide this tip" type="button">
          ×
        </button>
      </div>
      <p className="muted small">
        Gemma runs on this computer. To use the app on your phone outside, connect the two with Tailscale, which is free
        for personal use. Checking in works on the phone even without a signal.
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
    </section>
  );
}
