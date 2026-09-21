import { recordInsightChange, undoInsightChange } from './insightVersionService';
import { clearVersions, listVersions } from './insightVersionStore';
import { clearFeedback, getFeedback } from './feedbackStore';

function auditLines(spy: jest.SpyInstance): Array<Record<string, unknown>> {
  return spy.mock.calls
    .map((c) => {
      try {
        return JSON.parse(c[0] as string) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((l): l is Record<string, unknown> => l !== null);
}

beforeEach(() => {
  clearVersions();
  clearFeedback();
});

describe('undoInsightChange — irreversible (failure path)', () => {
  it('zero versions (nothing ever changed) is irreversible', () => {
    const result = undoInsightChange('k', 'T1');
    expect(result.outcome).toBe('irreversible');
  });

  it('exactly one version (the first-ever change) is irreversible — nothing before it', () => {
    recordInsightChange('k', 'T1', 'accurate', null);
    const result = undoInsightChange('k', 'T1');
    expect(result.outcome).toBe('irreversible');
  });
});

describe('undoInsightChange — restores the previous state (acceptance #2)', () => {
  it('restores the rating from before the most recent change', () => {
    recordInsightChange('k', 'T1', 'accurate', null);
    recordInsightChange('k', 'T1', 'inaccurate', 'looks off');

    const result = undoInsightChange('k', 'T1');

    expect(result.outcome).toBe('restored');
    expect(result.restoredRating).toBe('accurate');
    expect(result.restoredComment).toBeNull();
  });

  it('updates the live feedbackStore to match, in the same call (no version-control-error gap)', () => {
    recordInsightChange('k', 'T1', 'accurate', null);
    recordInsightChange('k', 'T1', 'inaccurate', null);

    undoInsightChange('k', 'T1');

    expect(getFeedback('k', 'T1')?.rating).toBe('accurate');
  });

  it('undo never deletes the change it reverses — history grows, it is not edited', () => {
    recordInsightChange('k', 'T1', 'accurate', null);
    recordInsightChange('k', 'T1', 'inaccurate', null);

    undoInsightChange('k', 'T1');

    const versions = listVersions('k', 'T1');
    expect(versions).toHaveLength(3);
    expect(versions.map((v) => v.reason)).toEqual(['change', 'change', 'undo']);
    expect(versions.map((v) => v.rating)).toEqual(['accurate', 'inaccurate', 'accurate']);
  });

  it('undo-of-undo toggles back and forth predictably', () => {
    recordInsightChange('k', 'T1', 'accurate', null);
    recordInsightChange('k', 'T1', 'inaccurate', null);

    const first = undoInsightChange('k', 'T1'); // -> accurate (restoring version 1)
    expect(first.restoredRating).toBe('accurate');

    const second = undoInsightChange('k', 'T1'); // undoes the undo -> back to inaccurate
    expect(second.outcome).toBe('restored');
    expect(second.restoredRating).toBe('inaccurate');
    expect(getFeedback('k', 'T1')?.rating).toBe('inaccurate');
  });
});

describe('Trust logging — every branch, including irreversible', () => {
  it('logs a change recording with a timestamp', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    recordInsightChange('k', 'T1', 'accurate', null);

    const line = auditLines(logSpy).find((l) => l.event === 'insight_change_recorded');
    expect(line).toMatchObject({ kpiKey: 'k', generatedAt: 'T1', rating: 'accurate' });
    expect(typeof line?.timestamp).toBe('string');
    logSpy.mockRestore();
  });

  it('logs a restored undo with a timestamp', () => {
    recordInsightChange('k', 'T1', 'accurate', null);
    recordInsightChange('k', 'T1', 'inaccurate', null);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    undoInsightChange('k', 'T1');

    const line = auditLines(logSpy).find((l) => l.event === 'insight_undo');
    expect(line).toMatchObject({ outcome: 'restored', restoredRating: 'accurate' });
    expect(typeof line?.timestamp).toBe('string');
    logSpy.mockRestore();
  });

  it('logs an irreversible attempt too — a rejected undo is still an activity', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    undoInsightChange('k', 'T1');

    const line = auditLines(logSpy).find((l) => l.event === 'insight_undo');
    expect(line).toMatchObject({ outcome: 'irreversible' });
    logSpy.mockRestore();
  });
});
