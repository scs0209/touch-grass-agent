import { useState } from 'react';
import { EMPTY_PREFERENCES } from '../constants/preferences';
import { useMessages } from '../i18n';
import type { Interest, Preferences, SavedChoice } from '../types/preferences';
import { LanguageSwitch } from './LanguageSwitch';

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
  onDone,
}: {
  initial: SavedChoice | null;
  onDone: (choice: SavedChoice) => void;
}) {
  const t = useMessages();
  const q = t.questionnaire;
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

  return (
    <main className="screen">
      <h1>{q.title}</h1>
      <p className="muted">{q.intro}</p>

      <button className="secondary" onClick={() => onDone({ mode: 'ai' })} type="button">
        {q.skip}
      </button>

      <ChoiceGroup
        title={q.pace}
        labels={t.preferences.pace}
        isActive={(pace) => preferences.pace === pace}
        onToggle={(pace) => update({ pace: preferences.pace === pace ? null : pace })}
      />
      <ChoiceGroup
        title={q.interests}
        hint={q.interestsHint}
        labels={t.preferences.interests}
        isActive={(interest) => preferences.interests.includes(interest)}
        onToggle={toggleInterest}
      />
      <ChoiceGroup
        title={q.company}
        labels={t.preferences.company}
        isActive={(company) => preferences.company === company}
        onToggle={(company) => update({ company: preferences.company === company ? null : company })}
      />
      <ChoiceGroup
        title={q.cycling}
        hint={q.cyclingHint}
        labels={t.preferences.cycling}
        isActive={(answer) => cycling === answer}
        onToggle={(answer) => update({ cycling: cycling === answer ? null : answer === 'yes' })}
      />

      <button className="primary" onClick={() => onDone({ mode: 'custom', preferences })} type="button">
        {q.save}
      </button>

      <div className="footer-links">
        <LanguageSwitch />
      </div>
    </main>
  );
}
