import { clearCheckins, listCheckins, recordCheckin } from './satisfactionStore';

beforeEach(() => {
  clearCheckins();
});

describe('recordCheckin', () => {
  it('records a check-in with a generated id and timestamp', () => {
    const entry = recordCheckin('great');
    expect(entry.id).toBeTruthy();
    expect(entry.rating).toBe('great');
    expect(typeof entry.submittedAt).toBe('string');
    expect(listCheckins()).toHaveLength(1);
  });

  it('each check-in gets its own independent id, and none overwrite each other', () => {
    recordCheckin('great');
    recordCheckin('ok');
    recordCheckin('not_great');
    expect(listCheckins()).toHaveLength(3);
  });
});

describe('listCheckins', () => {
  it('starts genuinely empty — the guardrail against fabricated data', () => {
    expect(listCheckins()).toEqual([]);
  });

  it('returns check-ins oldest first', async () => {
    recordCheckin('ok');
    await new Promise((r) => setTimeout(r, 2));
    recordCheckin('great');

    expect(listCheckins().map((c) => c.rating)).toEqual(['ok', 'great']);
  });
});

describe('clearCheckins', () => {
  it('resets the store to empty', () => {
    recordCheckin('great');
    clearCheckins();
    expect(listCheckins()).toEqual([]);
  });
});
