import type { MonthlyTotal } from '../types';
import { formatMonthLabel } from '../utils/dateFormat';

const CHART_HEIGHT = 140;
const BAR_GAP = 8;

export interface TrendBarChartProps {
  title: string;
  data: MonthlyTotal[];
  /** Which metric this chart plots — same MonthlyTotal[] feeds both charts. */
  metric: 'revenue' | 'expenses';
  color: string;
}

// Plain SVG bars, no charting library (this repo adds dependencies
// deliberately, not in passing — see CLAUDE.md's "drive-by npm install"
// rule). Months with no usable value for this metric are skipped rather
// than drawn as a fabricated zero-height bar.
export function TrendBarChart({ title, data, metric, color }: TrendBarChartProps) {
  const points = data
    .map((row) => ({ month: row.month, value: row[metric] }))
    .filter((row): row is { month: string; value: number } => row.value !== null);

  if (points.length === 0) {
    return (
      <section className="trend-chart" aria-label={title}>
        <h3 className="trend-chart__title">{title}</h3>
        <p className="trend-chart__empty">Not enough dated data yet to chart a trend.</p>
      </section>
    );
  }

  const maxValue = Math.max(...points.map((p) => p.value), 0);
  const barWidth = 100 / points.length;

  return (
    <section className="trend-chart" aria-label={title}>
      <h3 className="trend-chart__title">{title}</h3>
      <svg
        className="trend-chart__svg"
        viewBox={`0 0 100 ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${title}, ${points.length} month(s)`}
      >
        {points.map((point, i) => {
          const barHeight = maxValue === 0 ? 0 : (point.value / maxValue) * (CHART_HEIGHT - 24);
          const x = i * barWidth + BAR_GAP / 4;
          const width = Math.max(barWidth - BAR_GAP / 2, 1);
          return (
            <g key={point.month}>
              <title>{`${formatMonthLabel(point.month)}: ${point.value.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}`}</title>
              <rect
                x={x}
                y={CHART_HEIGHT - 24 - barHeight}
                width={width}
                height={barHeight}
                fill={color}
                rx={1}
              />
            </g>
          );
        })}
      </svg>
      <div className="trend-chart__labels">
        {points.map((point) => (
          <span key={point.month} className="trend-chart__label">
            {formatMonthLabel(point.month)}
          </span>
        ))}
      </div>
    </section>
  );
}
