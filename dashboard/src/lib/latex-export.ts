/**
 * Build safe-ish LaTeX for \\caption{...} (escape common special chars).
 */
export function escapeLatexCaption(raw: string): string {
  return raw
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/#/g, "\\#")
    .replace(/\$/g, "\\$")
    .replace(/%/g, "\\%")
    .replace(/&/g, "\\&")
    .replace(/_/g, "\\_")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/~/g, "\\textasciitilde{}");
}

/**
 * Lowercase slug suitable for \\label{fig:...} (no colons in input).
 */
export function slugifyLatexLabel(input: string): string {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return s.length > 0 ? s : "chart";
}

export function buildGraphicxPreambleComment(): string {
  return "% \\usepackage{graphicx}";
}

function normalizeCaptionInput(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function normalizeImagePath(raw: string): string {
  return raw.trim().replace(/[\r\n]+/g, "");
}

/**
 * Multi-line \\caption{...} with TeX `%` continuations so editors/LSPs are not confused
 * by soft-wrapped single lines. Short captions stay on one line.
 */
function buildCaptionBlock(safeCaption: string, maxSourceLine = 100): string {
  const open = "  \\caption{";
  const close = "}";
  const cont = "  ";
  if (open.length + safeCaption.length + close.length <= maxSourceLine) {
    return `${open}${safeCaption}${close}`;
  }
  const lines: string[] = [];
  let rest = safeCaption;
  let first = true;
  while (rest.length > 0) {
    const header = first ? open : cont;
    if (header.length + rest.length + close.length <= maxSourceLine) {
      lines.push(`${header}${rest}${close}`);
      break;
    }
    const maxChunk = maxSourceLine - header.length - 1; // trailing `%`
    let n = Math.min(rest.length, maxChunk);
    let breakPos = rest.lastIndexOf(" ", n);
    if (breakPos <= 0 || breakPos < n * 0.35) {
      breakPos = n;
    }
    const chunk = rest.slice(0, breakPos).trimEnd();
    const next = rest.slice(breakPos).trimStart();
    if (chunk.length === 0) {
      const hard = rest.slice(0, n);
      lines.push(`${header}${hard}%`);
      rest = rest.slice(n).trimStart();
    } else {
      lines.push(`${header}${chunk}%`);
      rest = next;
    }
    first = false;
  }
  return lines.join("\n");
}

export function buildLatexFigureSnippet(opts: {
  imagePath: string;
  caption: string;
  /** Without `fig:` prefix; `fig:` is added automatically. */
  label: string;
  floatPlacement?: string;
}): string {
  const placement = opts.floatPlacement ?? "htbp";
  const labelBody = opts.label.replace(/^fig:/, "");
  const captionNorm = normalizeCaptionInput(opts.caption);
  const imagePath = normalizeImagePath(opts.imagePath);
  const safeCaption = escapeLatexCaption(captionNorm);
  const captionBlock = buildCaptionBlock(safeCaption);
  return [
    buildGraphicxPreambleComment(),
    "",
    `\\begin{figure}[${placement}]`,
    "  \\centering",
    "  \\includegraphics[width=\\linewidth]%",
    `  {${imagePath}}`,
    captionBlock,
    `  \\label{fig:${labelBody}}`,
    "\\end{figure}",
    "",
  ].join("\n");
}
