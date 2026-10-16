import { useEffect, useRef, useState } from 'preact/hooks';
import { count } from './format';

/*
 * A bar chart drawn by the page itself (Dev Plan item 18m: no third-party
 * scripts), as inline SVG. Bars can stack several series (one colour each,
 * with a legend); hovering, focusing or tapping a bar shows its figures
 * above the chart, and the same figures are in a table under it.
 */

export interface Series {
  key: string;
  name: string;
  /** A CSS colour, from the page's tokens. */
  color: string;
}

export interface Bar {
  label: string;
  /** Each series' value, by key. */
  values: Record<string, number>;
  /** An extra line for the readout and table, e.g. how many started. */
  note?: string;
}

/** The chart's height; its width is the page's, so labels keep their size on a phone. */
const H = 180;
const LEFT = 40;
const BOTTOM = 22;
const TOP = 8;
const GAP = 2;

/** A round number at or above `n`: 1, 2 or 5 times a power of ten. */
export function niceMax(n: number): number {
  if (n <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(n));
  return ([1, 2, 5, 10].find((m) => m * power >= n) ?? 10) * power;
}

/** A bar's top segment: rounded at the top only, so it stands on the baseline. */
function roundedTop(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function BarChart({ title, series, bars, unit }: { title: string; series: Series[]; bars: Bar[]; unit: string }) {
  const [shown, setShown] = useState<number | null>(null);
  const [W, setWidth] = useState(640);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const measure = () => box.current && setWidth(Math.max(240, Math.round(box.current.clientWidth)));
    measure();
    addEventListener('resize', measure);
    return () => removeEventListener('resize', measure);
  }, []);
  const totals = bars.map((b) => series.reduce((sum, s) => sum + (b.values[s.key] ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const plotW = W - LEFT;
  const plotH = H - TOP - BOTTOM;
  const slot = plotW / Math.max(1, bars.length);
  const barW = Math.max(1, slot - GAP);
  const y = (v: number) => TOP + plotH - (v / max) * plotH;
  const at = shown ?? bars.length - 1;
  const describe = (i: number) => {
    const bar = bars[i];
    const parts = series.length > 1
      ? series.map((s) => `${s.name} ${count(bar.values[s.key] ?? 0)}`).join(', ')
      : '';
    return `${bar.label}: ${count(totals[i])} ${unit}${parts ? ` (${parts})` : ''}${bar.note ? `, ${bar.note}` : ''}`;
  };
  const labelled = bars.length > 0 ? [0, Math.floor((bars.length - 1) / 2), bars.length - 1] : [];

  return (
    <figure class="chart">
      <figcaption class="chart-title">{title}</figcaption>
      {series.length > 1 && (
        <ul class="legend">
          {series.map((s) => <li key={s.key}><span class="swatch" style={{ background: s.color }} />{s.name}</li>)}
        </ul>
      )}
      <p class="readout" aria-live="polite">{bars.length > 0 ? describe(at) : 'Nothing yet'}</p>
      <div ref={box}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}, as a bar chart; the table below has every figure`}>
          <line class="grid" x1={LEFT} x2={W} y1={y(max)} y2={y(max)} />
          <line class="grid" x1={LEFT} x2={W} y1={y(max / 2)} y2={y(max / 2)} />
          <line class="axis" x1={LEFT} x2={W} y1={y(0)} y2={y(0)} />
          <text class="tick" x={LEFT - 6} y={y(max) + 4} text-anchor="end">{count(max)}</text>
          <text class="tick" x={LEFT - 6} y={y(max / 2) + 4} text-anchor="end">{count(max / 2)}</text>
          <text class="tick" x={LEFT - 6} y={y(0) + 4} text-anchor="end">0</text>
          {bars.map((bar, i) => {
            const x = LEFT + i * slot + GAP / 2;
            let base = 0;
            const drawn = series.filter((s) => (bar.values[s.key] ?? 0) > 0);
            return (
              <g key={bar.label} class={i === at ? 'bar on' : 'bar'}>
                {drawn.map((s, k) => {
                  const value = bar.values[s.key];
                  const top = y(base + value);
                  // A surface gap between stacked segments.
                  const h = y(base) - top - (k > 0 ? GAP : 0);
                  base += value;
                  if (h <= 0) return null;
                  return k === drawn.length - 1
                    ? <path key={s.key} d={roundedTop(x, top, barW, h)} fill={s.color} />
                    : <rect key={s.key} x={x} y={top} width={barW} height={h} fill={s.color} />;
                })}
                <rect class="hit" x={LEFT + i * slot} y={TOP} width={slot} height={plotH} tabIndex={0}
                  aria-label={describe(i)} onMouseEnter={() => setShown(i)} onFocus={() => setShown(i)} onClick={() => setShown(i)} />
              </g>
            );
          })}
          {labelled.map((i) => (
            <text key={i} class="tick" x={LEFT + i * slot + slot / 2} y={H - 6}
              text-anchor={i === 0 ? 'start' : i === bars.length - 1 ? 'end' : 'middle'}>{bars[i].label}</text>
          ))}
        </svg>
      </div>
      <details class="table-view">
        <summary>Table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col" />
              {series.length > 1 && series.map((s) => <th key={s.key} scope="col">{s.name}</th>)}
              <th scope="col">Total</th>
              {bars.some((b) => b.note) && <th scope="col" />}
            </tr>
          </thead>
          <tbody>
            {bars.map((bar, i) => (
              <tr key={bar.label}>
                <th scope="row">{bar.label}</th>
                {series.length > 1 && series.map((s) => <td key={s.key}>{count(bar.values[s.key] ?? 0)}</td>)}
                <td>{count(totals[i])}</td>
                {bars.some((b) => b.note) && <td>{bar.note}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
