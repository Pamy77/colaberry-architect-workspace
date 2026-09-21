const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function parseIsoDate(iso: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})-\d{2}/.exec(iso);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1 };
}

// e.g. "Feb to Jun 2026", or "Feb 2026 to Jun 2027" across a year boundary.
export function formatDateRangeLabel(range: { start: string; end: string } | null): string | null {
  if (!range) return null;
  const start = parseIsoDate(range.start);
  const end = parseIsoDate(range.end);
  if (!start || !end) return null;

  if (start.year === end.year && start.month === end.month) {
    return `${MONTH_NAMES[start.month]} ${start.year}`;
  }
  if (start.year === end.year) {
    return `${MONTH_NAMES[start.month]} to ${MONTH_NAMES[end.month]} ${start.year}`;
  }
  return `${MONTH_NAMES[start.month]} ${start.year} to ${MONTH_NAMES[end.month]} ${end.year}`;
}

// "2026-02" -> "Feb 2026". Used for chart axis labels, same YYYY-MM shape
// the backend's monthKeyOf() groups by.
export function formatMonthLabel(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return monthKey;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  return `${MONTH_NAMES[month] ?? monthKey} ${year}`;
}
