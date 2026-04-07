/** Pixel-space label placement for scatter charts (greedy, no overlaps). */

export type ScatterLabelPoint = {
  key: string;
  name: string;
  x: number;
  y: number;
};

export type ScatterLabelLayout = {
  textAnchor: "start" | "end" | "middle";
  dominantBaseline: "alphabetic" | "middle" | "hanging";
  offsetX: number;
  offsetY: number;
};

type Margin = { top: number; right: number; left: number; bottom: number };

type BBox = { left: number; right: number; top: number; bottom: number };

function labelSize(name: string): { w: number; h: number } {
  const w = Math.min(200, 10 + name.length * 5.6);
  return { w, h: 13 };
}

function overlaps(a: BBox, b: BBox, pad: number): boolean {
  return !(
    a.right + pad < b.left ||
    b.right + pad < a.left ||
    a.bottom + pad < b.top ||
    b.bottom + pad < a.top
  );
}

function anyOverlap(box: BBox, placed: BBox[], pad: number): boolean {
  return placed.some((p) => overlaps(box, p, pad));
}

function dataToPixel(
  x: number,
  y: number,
  xs: { min: number; max: number },
  ys: { min: number; max: number },
  innerW: number,
  innerH: number,
  margin: Margin
): { cx: number; cy: number } {
  const xv = xs.max - xs.min || 1;
  const yv = ys.max - ys.min || 1;
  const cx = margin.left + ((x - xs.min) / xv) * innerW;
  const cy = margin.top + ((ys.max - y) / yv) * innerH;
  return { cx, cy };
}

type Candidate = {
  offsetX: number;
  offsetY: number;
  textAnchor: ScatterLabelLayout["textAnchor"];
  dominantBaseline: ScatterLabelLayout["dominantBaseline"];
  box: (cx: number, cy: number, w: number, h: number) => BBox;
};

function buildCandidates(dotR: number, gap: number, w: number, h: number): Candidate[] {
  const g = gap + dotR;
  const hm = h / 2;
  return [
    {
      offsetX: g + 2,
      offsetY: 3,
      textAnchor: "start",
      dominantBaseline: "middle",
      box: (cx, cy) => ({
        left: cx + g,
        right: cx + g + w,
        top: cy - hm,
        bottom: cy + hm,
      }),
    },
    {
      offsetX: -g - 2,
      offsetY: 3,
      textAnchor: "end",
      dominantBaseline: "middle",
      box: (cx, cy) => ({
        left: cx - g - w,
        right: cx - g,
        top: cy - hm,
        bottom: cy + hm,
      }),
    },
    {
      offsetX: 0,
      offsetY: -g - hm - 1,
      textAnchor: "middle",
      dominantBaseline: "middle",
      box: (cx, cy) => ({
        left: cx - w / 2,
        right: cx + w / 2,
        top: cy - g - h - 1,
        bottom: cy - g - 1,
      }),
    },
    {
      offsetX: 0,
      offsetY: g + hm + 1,
      textAnchor: "middle",
      dominantBaseline: "middle",
      box: (cx, cy) => ({
        left: cx - w / 2,
        right: cx + w / 2,
        top: cy + g + 1,
        bottom: cy + g + h + 1,
      }),
    },
    {
      offsetX: g + 2,
      offsetY: -hm - 10,
      textAnchor: "start",
      dominantBaseline: "middle",
      box: (cx, cy) => ({
        left: cx + g,
        right: cx + g + w,
        top: cy - hm - 12,
        bottom: cy - hm + 2,
      }),
    },
    {
      offsetX: g + 2,
      offsetY: hm + 10,
      textAnchor: "start",
      dominantBaseline: "middle",
      box: (cx, cy) => ({
        left: cx + g,
        right: cx + g + w,
        top: cy + hm - 2,
        bottom: cy + hm + 12,
      }),
    },
    {
      offsetX: -g - 2,
      offsetY: -hm - 10,
      textAnchor: "end",
      dominantBaseline: "middle",
      box: (cx, cy) => ({
        left: cx - g - w,
        right: cx - g,
        top: cy - hm - 12,
        bottom: cy - hm + 2,
      }),
    },
    {
      offsetX: -g - 2,
      offsetY: hm + 10,
      textAnchor: "end",
      dominantBaseline: "middle",
      box: (cx, cy) => ({
        left: cx - g - w,
        right: cx - g,
        top: cy + hm - 2,
        bottom: cy + hm + 12,
      }),
    },
  ];
}

/**
 * Greedy placement in pixel space matching linear Recharts scales (y inverted: higher y = higher on screen).
 */
export function computeScatterLabelLayouts(
  points: ScatterLabelPoint[],
  opts: {
    width: number;
    height: number;
    margin: Margin;
    dotR?: number;
  }
): Map<string, ScatterLabelLayout> {
  const { width, height, margin } = opts;
  const dotR = opts.dotR ?? 6;
  const innerW = Math.max(40, width - margin.left - margin.right);
  const innerH = Math.max(40, height - margin.top - margin.bottom);
  const out = new Map<string, ScatterLabelLayout>();

  if (points.length === 0) return out;

  const xs = { min: Math.min(...points.map((p) => p.x)), max: Math.max(...points.map((p) => p.x)) };
  const ys = { min: Math.min(...points.map((p) => p.y)), max: Math.max(...points.map((p) => p.y)) };
  if (xs.min === xs.max) {
    xs.min -= 1;
    xs.max += 1;
  }
  if (ys.min === ys.max) {
    ys.min -= 1;
    ys.max += 1;
  }

  const withPx = points.map((p) => ({
    ...p,
    ...dataToPixel(p.x, p.y, xs, ys, innerW, innerH, margin),
  }));

  const sorted = [...withPx].sort((a, b) => b.cx - a.cx || a.cy - b.cy);
  const placed: BBox[] = [];
  const pad = 4;

  for (const p of sorted) {
    const { w, h } = labelSize(p.name);
    const cands = buildCandidates(dotR, 4, w, h);
    let chosen: ScatterLabelLayout | null = null;

    for (const c of cands) {
      const box = c.box(p.cx, p.cy, w, h);
      if (!anyOverlap(box, placed, pad)) {
        placed.push(box);
        chosen = {
          textAnchor: c.textAnchor,
          dominantBaseline: c.dominantBaseline,
          offsetX: c.offsetX,
          offsetY: c.offsetY,
        };
        break;
      }
    }

    if (!chosen) {
      const stack = placed.filter((b) => Math.abs(b.left - (p.cx + dotR + 6)) < 40).length;
      const offsetY = 3 + stack * 15;
      const box: BBox = {
        left: p.cx + dotR + 4,
        right: p.cx + dotR + 4 + w,
        top: p.cy + offsetY - h / 2,
        bottom: p.cy + offsetY + h / 2,
      };
      placed.push(box);
      chosen = {
        textAnchor: "start",
        dominantBaseline: "middle",
        offsetX: dotR + 6,
        offsetY,
      };
    }

    out.set(p.key, chosen);
  }

  return out;
}
