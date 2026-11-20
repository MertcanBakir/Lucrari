import type { PortfolioChartPoint } from '@/types/portfolio-chart';

export function chartDateLabel(date: string, full = false): string {
  return new Intl.DateTimeFormat('tr-TR', { timeZone: 'UTC', day: 'numeric', month: full ? 'long' : 'short', ...(full ? { year: 'numeric' } as const : {}) })
    .format(new Date(`${date}T12:00:00Z`));
}

/** Time-proportional coordinates; missing values split the line instead of becoming zero. */
export function buildChartGeometry(points: PortfolioChartPoint[], width: number, height: number, includeZero: boolean) {
  const values = points.flatMap(p => p.value === null ? [] : [p.value]);
  if (!values.length || width <= 0) return null;
  const padding = 12;
  let minimum = Math.min(...values);
  let maximum = Math.max(...values);
  if (includeZero) { minimum = Math.min(0, minimum); maximum = Math.max(0, maximum); }
  const buffer = (maximum - minimum || Math.abs(maximum) || 1) * 0.1;
  minimum -= buffer; maximum += buffer;
  const firstTime = Date.parse(points[0].date);
  const duration = Date.parse(points[points.length - 1].date) - firstTime;
  const coordinates = points.map(p => ({
    x: duration === 0 ? width / 2 : padding + ((Date.parse(p.date) - firstTime) / duration) * (width - padding * 2),
    y: p.value === null ? null : padding + ((maximum - p.value) / (maximum - minimum)) * (height - padding * 2),
  }));
  let path = '';
  let connected = false;
  for (const point of coordinates) {
    if (point.y === null) { connected = false; continue; }
    path += `${connected ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)} `;
    connected = true;
  }
  return { coordinates, path, minimum, maximum };
}

export function closestChartIndex(xs: number[], location: number): number {
  if (!xs.length) return -1;
  let low = 0; let high = xs.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (xs[middle] < location) low = middle + 1; else high = middle;
  }
  return low > 0 && location - xs[low - 1] < xs[low] - location ? low - 1 : low;
}
