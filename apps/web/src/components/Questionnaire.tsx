import { useState } from 'react';
import { ONBOARDING_PRIVACY, ONBOARDING_STEPS } from '../constants/onboarding';
import {
  COMPANY_LABELS,
  CYCLING_LABELS,
  EMPTY_PREFERENCES,
  INTEREST_LABELS,
  PACE_LABELS,
} from '../constants/preferences';
import type { Interest, Preferences, SavedChoice } from '../types/preferences';

interface ChoiceGroupProps<T extends string> {
  title: string;
  hint?: string;
  labels: Record<T, string>;
  isActive: (value: T) => boolean;
  onToggle: (value: T) => void;
}

function ChoiceGroup<T extends string>({ title, hint, labels, isActive, onToggle }: ChoiceGroupProps<T>) {
  return (
    <section className="panel">
      <p className="tile-label">{title}</p>
      {hint && <p className="muted small">{hint}</p>}
      <div className="chips wrap">
        {(Object.keys(labels) as T[]).map((value) => (
          <button
            key={value}
            className={isActive(value) ? 'chip active' : 'chip'}
            aria-pressed={isActive(value)}
            onClick={() => onToggle(value)}
            type="button"
          >
            {labels[value]}
          </button>
        ))}
      </div>
    </section>
  );
}

function cyclingAnswer(cycling: boolean | null) {
  if (cycling === null) return null;
  return cycling ? 'yes' : 'no';
}

export function Questionnaire({
  initial,
  firstVisit,
  onDone,
}: {
  initial: SavedChoice | null;
  /** Explains the app above the questions; editing the answers later goes straight to them. */
  firstVisit: boolean;
  onDone: (choice: SavedChoice) => void;
}) {
  const [preferences, setPreferences] = useState<Preferences>(
    initial?.mode === 'custom' ? initial.preferences : EMPTY_PREFERENCES,
  );
  const update = (patch: Partial<Preferences>) => setPreferences((current) => ({ ...current, ...patch }));
  const toggleInterest = (interest: Interest) =>
    update({
      interests: preferences.interests.includes(interest)
        ? preferences.interests.filter((picked) => picked !== interest)
        : [...preferences.interests, interest],
    });
  const cycling = cyclingAnswer(preferences.cycling);
  // The app's name heads the first visit, so the questions sit one level below it.
  const Title = firstVisit ? 'h2' : 'h1';

  return (
    <main className="screen">
      {firstVisit && (
        <>
          <h1>Should I go out?</h1>
          <section className="panel onboarding" aria-labelledby="onboarding-title">
            <p id="onboarding-title" className="onboarding-lead">
              One suggestion for right now. Then put your phone away.
            </p>
            <ol className="onboarding-steps">
              {ONBOARDING_STEPS.map((step) => (
                <li key={step.text}>
                  <span aria-hidden="true">{step.icon}</span>
                  {step.text}
                </li>
              ))}
            </ol>
            <p className="muted small">{ONBOARDING_PRIVACY}</p>
          </section>
        </>
      )}

      <Title className="questionnaire-title">What do you like?</Title>
      <p className="muted">A few quick picks help the suggestions fit you. Skip any question you like.</p>

      <button className="secondary" onClick={() => onDone({ mode: 'ai' })} type="button">
        Skip and let the AI decide everything
      </button>

      <ChoiceGroup
        title="How do you like to move?"
        labels={PACE_LABELS}
        isActive={(pace) => preferences.pace === pace}
        onToggle={(pace) => update({ pace: preferences.pace === pace ? null : pace })}
      />
      <ChoiceGroup
        title="What do you enjoy?"
        hint="Pick as many as you like."
        labels={INTEREST_LABELS}
        isActive={(interest) => preferences.interests.includes(interest)}
        onToggle={toggleInterest}
      />
      <ChoiceGroup
        title="Who usually comes along?"
        labels={COMPANY_LABELS}
        isActive={(company) => preferences.company === company}
        onToggle={(company) => update({ company: preferences.company === company ? null : company })}
      />
      <ChoiceGroup
        title="Public bikes?"
        hint="Rides are suggested only if you pick yes (Seoul, 30 minutes or more). Otherwise you walk."
        labels={CYCLING_LABELS}
        isActive={(answer) => cycling === answer}
        onToggle={(answer) => update({ cycling: cycling === answer ? null : answer === 'yes' })}
      />

      <button className="primary" onClick={() => onDone({ mode: 'custom', preferences })} type="button">
        Save my picks
      </button>
    </main>
  );
}
