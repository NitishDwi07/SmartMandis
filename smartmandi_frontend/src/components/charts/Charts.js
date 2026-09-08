import React, { useId, useMemo } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line,
  CartesianGrid, XAxis, YAxis, Tooltip
} from 'recharts';
import './Charts.css';

/*
 * Categorical slots, in the validated fixed order. Assigned by entity in a
 * stable order and never cycled — a filter that changes the series count must
 * not repaint the survivors. Past MAX_SERIES everything folds into "Other".
 */
export const SERIES_COLORS = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'
];
const OTHER_COLOR = 'var(--series-other)';
const MAX_SERIES = 6;

const axisStyle = { fill: 'var(--ink-muted)', fontSize: 11 };

/* ------------------------------------------------------------------ tooltip */

function ChartTooltip({ active, payload, label, valueFormat }) {
  if (!active || !payload?.length) return null;

  const rows = [...payload].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  return (
    <div className="chart-tip">
      <div className="chart-tip__head">{label}</div>
      <div className="chart-tip__rows">
        {rows.map((row) => (
          <div className="chart-tip__row" key={row.dataKey}>
            <span className="chart-tip__swatch" style={{ background: row.stroke || row.color }} />
            <span className="chart-tip__name">{row.name}</span>
            <span className="chart-tip__value tabular">
              {valueFormat ? valueFormat(row.value) : row.value?.toLocaleString('en-IN')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- legend */

export function ChartLegend({ items }) {
  return (
    <ul className="chart-legend">
      {items.map((item) => (
        <li key={item.key} className="chart-legend__item">
          <span className="chart-legend__swatch" style={{ background: item.color }} aria-hidden="true" />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------- demand chart
 *
 * Multi-category demand over the week. Categories are ranked by total volume;
 * beyond MAX_SERIES they collapse into a single "Other" line rather than being
 * given generated hues.
 * ---------------------------------------------------------------------- */

export function DemandTrendChart({ data, height = 340 }) {
  const gradientId = useId();

  const { rows, series } = useMemo(() => {
    if (!data?.length) return { rows: [], series: [] };

    const keys = Object.keys(data[0]).filter((k) => k !== 'day');
    const totals = keys.map((k) => ({
      key: k,
      total: data.reduce((sum, row) => sum + (Number(row[k]) || 0), 0)
    })).sort((a, b) => b.total - a.total);

    const kept = totals.slice(0, MAX_SERIES).map((t) => t.key);
    const folded = totals.slice(MAX_SERIES).map((t) => t.key);

    const rows = data.map((row) => {
      const next = { day: row.day, dayShort: String(row.day).slice(0, 3) };
      kept.forEach((k) => { next[k] = Number(row[k]) || 0; });
      if (folded.length) {
        next.Other = folded.reduce((sum, k) => sum + (Number(row[k]) || 0), 0);
      }
      return next;
    });

    const series = kept.map((key, i) => ({ key, label: key, color: SERIES_COLORS[i] }));
    if (folded.length) {
      series.push({ key: 'Other', label: `Other (${folded.length})`, color: OTHER_COLOR });
    }

    return { rows, series };
  }, [data]);

  if (!rows.length) return null;

  return (
    <>
      <div className="chart-frame" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id={`${gradientId}-glow`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke="var(--gridline)" strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="dayShort"
              tick={axisStyle}
              tickLine={false}
              axisLine={{ stroke: 'var(--axis)' }}
              dy={6}
            />
            <YAxis
              tick={axisStyle}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
            />

            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4.5, strokeWidth: 2, stroke: 'var(--surface-1)' }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend items={series} />
    </>
  );
}

/* --------------------------------------------------------------- price chart
 *
 * Current vs recommended price per category. Both series are rupees on one
 * shared axis — never a second y-scale.
 * ---------------------------------------------------------------------- */

export function PriceCompareChart({ data, height = 340 }) {
  const gradientId = useId();

  const series = [
    { key: 'avg_current_price', label: 'Current price', color: SERIES_COLORS[0] },
    { key: 'avg_recommended_price', label: 'Recommended price', color: SERIES_COLORS[1] }
  ];

  if (!data?.length) return null;

  const money = (v) => (typeof v === 'number' ? `₹${v.toFixed(2)}` : '—');

  return (
    <>
      <div className="chart-frame" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {/* Right margin leaves room for the final category tick, which is
              centred on the last point and would otherwise clip. */}
          <AreaChart data={data} margin={{ top: 8, right: 28, left: -12, bottom: 0 }}>
            <defs>
              {series.map((s, i) => (
                <linearGradient key={s.key} id={`${gradientId}-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>

            <CartesianGrid stroke="var(--gridline)" vertical={false} />
            <XAxis
              dataKey="category"
              tick={axisStyle}
              tickLine={false}
              axisLine={{ stroke: 'var(--axis)' }}
              dy={6}
              interval={0}
              angle={data.length > 6 ? -30 : 0}
              textAnchor={data.length > 6 ? 'end' : 'middle'}
              height={data.length > 6 ? 56 : 30}
            />
            <YAxis
              tick={axisStyle}
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(v) => `₹${v}`}
            />
            <Tooltip
              content={<ChartTooltip valueFormat={money} />}
              cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
            />

            {series.map((s, i) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                fill={`url(#${gradientId}-${i})`}
                dot={false}
                activeDot={{ r: 4.5, strokeWidth: 2, stroke: 'var(--surface-1)' }}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend items={series} />
    </>
  );
}

/* ---------------------------------------------------------------- sparkline
 *
 * Decorative trend hint inside a stat tile. No axes, no tooltip — the tile's
 * number is the datum; this only shows shape.
 * ---------------------------------------------------------------------- */

export function Sparkline({ values, color = 'var(--accent-bright)' }) {
  const gradientId = useId();

  if (!values?.length || values.length < 2) return null;

  const w = 200;
  const h = 46;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const points = values.map((v, i) => [
    (i / (values.length - 1)) * w,
    h - ((v - min) / span) * (h - 8) - 4
  ]);

  const line = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.32} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
