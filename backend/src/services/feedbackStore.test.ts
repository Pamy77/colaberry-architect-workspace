import {
  clearFeedback,
  getFeedback,
  hasFeedback,
  listFeedback,
  recordFeedback,
} from './feedbackStore';

beforeEach(() => {
  clearFeedback();
});

describe('recordFeedback', () => {
  it('records new feedback and reports updated: false', () => {
    const { entry, updated } = recordFeedback({
      kpiKey: 'business.revenue.total',
      generatedAt: 'T1',
      rating: 'accurate',
    });

    expect(updated).toBe(false);
    expect(entry.kpiKey).toBe('business.revenue.total');
    expect(entry.generatedAt).toBe('T1');
    expect(entry.rating).toBe('accurate');
    expect(entry.comment).toBeNull();
    expect(typeof entry.submittedAt).toBe('string');
  });

  it('resubmitting for the same (kpiKey, generatedAt) updates in place, not a duplicate', () => {
    recordFeedback({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'accurate' });
    const second = recordFeedback({
      kpiKey: 'business.revenue.total',
      generatedAt: 'T1',
      rating: 'inaccurate',
      comment: 'looks wrong',
    });

    expect(second.updated).toBe(true);
    expect(getFeedback('business.revenue.total', 'T1')?.rating).toBe('inaccurate');
    expect(getFeedback('business.revenue.total', 'T1')?.comment).toBe('looks wrong');
    expect(listFeedback()).toHaveLength(1); // no duplicate entry
  });

  it('the same kpiKey at a different generatedAt is an independent insight', () => {
    recordFeedback({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'accurate' });
    recordFeedback({ kpiKey: 'business.revenue.total', generatedAt: 'T2', rating: 'inaccurate' });

    expect(getFeedback('business.revenue.total', 'T1')?.rating).toBe('accurate');
    expect(getFeedback('business.revenue.total', 'T2')?.rating).toBe('inaccurate');
    expect(listFeedback()).toHaveLength(2);
  });
});

describe('hasFeedback / getFeedback', () => {
  it('returns false/undefined for an insight that has never received feedback', () => {
    expect(hasFeedback('business.revenue.total', 'T1')).toBe(false);
    expect(getFeedback('business.revenue.total', 'T1')).toBeUndefined();
  });

  it('returns true/defined once feedback has been recorded', () => {
    recordFeedback({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'accurate' });
    expect(hasFeedback('business.revenue.total', 'T1')).toBe(true);
    expect(getFeedback('business.revenue.total', 'T1')).toBeDefined();
  });
});

describe('listFeedback', () => {
  it('returns an empty list when nothing has been submitted', () => {
    expect(listFeedback()).toEqual([]);
  });

  it('returns entries newest first', async () => {
    recordFeedback({ kpiKey: 'a', generatedAt: 'T1', rating: 'accurate' });
    await new Promise((r) => setTimeout(r, 2));
    recordFeedback({ kpiKey: 'b', generatedAt: 'T1', rating: 'accurate' });

    expect(listFeedback().map((f) => f.kpiKey)).toEqual(['b', 'a']);
  });
});

describe('clearFeedback', () => {
  it('resets the store to empty', () => {
    recordFeedback({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'accurate' });
    clearFeedback();
    expect(listFeedback()).toEqual([]);
  });
});
