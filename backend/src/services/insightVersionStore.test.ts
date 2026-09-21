import { appendVersion, clearVersions, listVersions } from './insightVersionStore';

beforeEach(() => {
  clearVersions();
});

describe('appendVersion / listVersions', () => {
  it('starts empty for an insight that has never changed', () => {
    expect(listVersions('business.revenue.total', 'T1')).toEqual([]);
  });

  it('appends a version with a generated id and timestamp', () => {
    const entry = appendVersion({
      kpiKey: 'business.revenue.total',
      generatedAt: 'T1',
      rating: 'accurate',
      comment: null,
      reason: 'change',
    });

    expect(entry.id).toBeTruthy();
    expect(entry.reason).toBe('change');
    expect(typeof entry.recordedAt).toBe('string');
    expect(listVersions('business.revenue.total', 'T1')).toHaveLength(1);
  });

  it('never overwrites — multiple changes accumulate, oldest first', async () => {
    appendVersion({ kpiKey: 'k', generatedAt: 'T1', rating: 'accurate', comment: null, reason: 'change' });
    await new Promise((r) => setTimeout(r, 2));
    appendVersion({ kpiKey: 'k', generatedAt: 'T1', rating: 'inaccurate', comment: null, reason: 'change' });
    await new Promise((r) => setTimeout(r, 2));
    appendVersion({ kpiKey: 'k', generatedAt: 'T1', rating: 'accurate', comment: null, reason: 'undo' });

    const versions = listVersions('k', 'T1');
    expect(versions).toHaveLength(3);
    expect(versions.map((v) => v.reason)).toEqual(['change', 'change', 'undo']);
  });

  it('keeps independent histories per (kpiKey, generatedAt)', () => {
    appendVersion({ kpiKey: 'a', generatedAt: 'T1', rating: 'accurate', comment: null, reason: 'change' });
    appendVersion({ kpiKey: 'a', generatedAt: 'T2', rating: 'inaccurate', comment: null, reason: 'change' });
    appendVersion({ kpiKey: 'b', generatedAt: 'T1', rating: 'accurate', comment: null, reason: 'change' });

    expect(listVersions('a', 'T1')).toHaveLength(1);
    expect(listVersions('a', 'T2')).toHaveLength(1);
    expect(listVersions('a', 'T1')[0].rating).toBe('accurate');
    expect(listVersions('a', 'T2')[0].rating).toBe('inaccurate');
  });
});

describe('clearVersions', () => {
  it('resets all history to empty', () => {
    appendVersion({ kpiKey: 'k', generatedAt: 'T1', rating: 'accurate', comment: null, reason: 'change' });
    clearVersions();
    expect(listVersions('k', 'T1')).toEqual([]);
  });
});
