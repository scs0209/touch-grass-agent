import { useState } from 'react';
import {
  COMPANY_LABELS,
  CYCLING_LABELS,
  EMPTY_PREFERENCES,
  INTEREST_LABELS,
  PACE_LABELS,
  type Interest,
  type Preferences,
  type SavedChoice,
} from './preferences';

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
          >
            {labels[value]}
          </button>
        ))}
      </div>
    </section>
  );
}

export function Questionnaire({ initial, onDone }: { initial: SavedChoice | null; onDone: (choice: SavedChoice) => void }) {
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
  const cycling = preferences.cycling === null ? null : preferences.cycling ? 'yes' : 'no';

  return (
    <main className="screen">
      <h1>What do you like?</h1>
      <p className="muted">A few quick picks help the suggestions fit you. Skip any question you like.</p>

      <button className="secondary" onClick={() => onDone({ mode: 'ai' })}>
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
        labels={CYCLING_LABELS}
        isActive={(answer) => cycling === answer}
        onToggle={(answer) => update({ cycling: cycling === answer ? null : answer === 'yes' })}
      />

      <button className="primary" onClick={() => onDone({ mode: 'custom', preferences })}>
        Save my picks
      </button>
    </main>
  );
}
