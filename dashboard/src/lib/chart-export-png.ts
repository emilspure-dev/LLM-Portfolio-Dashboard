import { toPng } from "html-to-image";
import { slugifyLatexLabel } from "@/lib/latex-export";

/** Solid background close to `.dashboard-panel` / glass cards (255,255,252). */
export const CHART_CAPTURE_BG = "rgb(255, 255, 252)";

function captureFilter(node: Node): boolean {
  if (!(node instanceof HTMLElement)) return true;
  if (node.classList.contains("recharts-tooltip-wrapper")) return false;
  if (node.classList.contains("recharts-tooltip-cursor")) return false;
  if (node.classList.contains("recharts-cursor")) return false;
  return true;
}

export async function exportElementToPngDownload(
  element: HTMLElement,
  opts: { fileBaseName: string; pixelRatio?: number }
): Promise<void> {
  const filename = `${slugifyLatexLabel(opts.fileBaseName)}.png`;
  const dataUrl = await toPng(element, {
    pixelRatio: opts.pixelRatio ?? 2.5,
    cacheBust: true,
    backgroundColor: CHART_CAPTURE_BG,
    filter: captureFilter,
  });
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.rel = "noopener";
  link.click();
}
