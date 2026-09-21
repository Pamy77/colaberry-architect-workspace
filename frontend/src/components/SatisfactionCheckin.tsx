import { useState } from 'react';
import { submitSatisfactionCheckin, SatisfactionApiError, type SatisfactionRating } from '../services/satisfactionApi';

/**
 * A quiet, three-option interface satisfaction check-in (STORY-010 /
 * REQ-014). Deliberately not prominent — placed after the KPI content on
 * the dashboard, not competing with the primary upload/KPI focus. See the
 * "Satisfaction trend mechanism" section of
 * `directives/12-ui-simplicity.md`.
 */

type CheckinState = { phase: 'idle' | 'submitting' | 'done' } | { phase: 'error'; message: string };

export function SatisfactionCheckin() {
  const [state, setState] = useState<CheckinState>({ phase: 'idle' });

  async function handleRate(rating: SatisfactionRating): Promise<void> {
    setState({ phase: 'submitting' });
    try {
      await submitSatisfactionCheckin(rating);
      setState({ phase: 'done' });
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof SatisfactionApiError ? err.message : 'Could not submit your check-in.',
      });
    }
  }

  if (state.phase === 'done') {
    return (
      <section className="satisfaction-checkin" aria-label="Interface satisfaction check-in">
        <p role="status">Thanks for letting us know.</p>
      </section>
    );
  }

  return (
    <section className="satisfaction-checkin" aria-label="Interface satisfaction check-in">
      <p>How&rsquo;s this dashboard working for you?</p>
      <div className="satisfaction-checkin__options">
        <button type="button" onClick={() => void handleRate('great')} disabled={state.phase === 'submitting'}>
          🙂 Great
        </button>
        <button type="button" onClick={() => void handleRate('ok')} disabled={state.phase === 'submitting'}>
          😐 OK
        </button>
        <button type="button" onClick={() => void handleRate('not_great')} disabled={state.phase === 'submitting'}>
          🙁 Not great
        </button>
      </div>

      {state.phase === 'error' && (
        <div className="satisfaction-checkin__error" role="alert">
          <p>{state.message}</p>
        </div>
      )}
    </section>
  );
}
