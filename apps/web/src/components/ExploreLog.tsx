import type { Visit } from '../types/explore';
import { badges, describeStats, exploreStats, isDone, missions, visitDate } from '../utils/explore';
import { placeArea } from '../utils/places';

const MAX_MISSIONS = 3;
const MAX_RECENT_VISITS = 3;

/** The places the person actually went to, compared only with their own earlier weeks. */
export function ExploreLog({ visits }: { visits: Visit[] }) {
  const stats = exploreStats(visits);
  // Lasting goals move to the badges once reached; today's and this week's stay to show they're done.
  const shown = missions(visits)
    .filter((mission) => mission.repeats || !isDone(mission))
    .slice(0, MAX_MISSIONS);
  const earned = badges(visits);

  return (
    <section className="panel explore-log" aria-labelledby="explore-log-title">
      <h2 id="explore-log-title">Your explorations</h2>
      {visits.length === 0 ? (
        <p className="muted small">
          Check in when you reach a suggested place and it shows up here. Nothing leaves this device.
        </p>
      ) : (
        <>
          <p className="explore-stats">{describeStats(stats)}</p>
          <dl className="explore-weeks">
            <div>
              <dt className="tile-label">This week</dt>
              <dd className="tile-value">{stats.thisWeek}</dd>
            </div>
            <div>
              <dt className="tile-label">Last week</dt>
              <dd className="tile-value">{stats.lastWeek}</dd>
            </div>
            <div>
              <dt className="tile-label">Best week</dt>
              <dd className="tile-value">{stats.bestWeek}</dd>
            </div>
          </dl>
        </>
      )}

      <ul className="missions">
        {shown.map((mission) => (
          <li key={mission.id} className={isDone(mission) ? 'mission done' : 'mission'}>
            <span className="mission-title">
              {isDone(mission) && '✓ '}
              {mission.title}
            </span>
            <span className="muted small">
              {mission.progress}/{mission.goal}
            </span>
            <progress max={mission.goal} value={mission.progress} aria-label={mission.title} />
          </li>
        ))}
      </ul>

      {earned.length > 0 && (
        <ul className="badges" aria-label="Badges">
          {earned.map((badge) => (
            <li key={badge.id} title={badge.detail}>
              {badge.title}
            </li>
          ))}
        </ul>
      )}

      {visits.length > 0 && (
        <ul className="explore-recent" aria-label="Recently explored">
          {visits.slice(0, MAX_RECENT_VISITS).map((visit) => (
            <li key={`${visit.name}-${visit.at}`}>
              <span className="recent-name">{visit.name}</span>
              <span className="muted small">{[placeArea(visit), visitDate(visit.at)].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
