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

export function buildLatexFigureSnippet(opts: {
  imagePath: string;
  caption: string;
  /** Without `fig:` prefix; `fig:` is added automatically. */
  label: string;
  floatPlacement?: string;
}): string {
  const placement = opts.floatPlacement ?? "htbp";
  const labelBody = opts.label.replace(/^fig:/, "");
  const safeCaption = escapeLatexCaption(opts.caption);
  return [
    buildGraphicxPreambleComment(),
    "",
    `\\begin{figure}[${placement}]`,
    "  \\centering",
    `  \\includegraphics[width=\\linewidth]{${opts.imagePath}}`,
    `  \\caption{${safeCaption}}`,
    `  \\label{fig:${labelBody}}`,
    "\\end{figure}",
    "",
  ].join("\n");
}
