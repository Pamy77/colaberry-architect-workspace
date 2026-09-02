import type { Kpi, KpiUnit } from '../types';

const FORMATTERS: Record<KpiUnit, (value: number) => string> = {
  // Currency assumes USD for now (small-business default); a later story can
  // make this configurable.
  currency: (value) => value.toLocaleString(undefined, { style: 'currency', currency: 'USD' }),
  ratio: (value) => `${(value * 100).toFixed(1)}%`,
  number: (value) => value.toLocaleString(),
};

const EVIDENCE_LABEL: Record<Kpi['evidenceLevel'], string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

export function KpiCard({ kpi }: { kpi: Kpi }) {
  return (
    <article className="kpi-card" aria-label={kpi.label}>
      <h3 className="kpi-card__label">{kpi.label}</h3>
      <p className="kpi-card__value">{FORMATTERS[kpi.unit](kpi.value)}</p>
      <span className={`kpi-card__evidence kpi-card__evidence--${kpi.evidenceLevel}`}>
        {EVIDENCE_LABEL[kpi.evidenceLevel]}
      </span>
      <p className="kpi-card__note">{kpi.evidenceNote}</p>
    </article>
  );
}
