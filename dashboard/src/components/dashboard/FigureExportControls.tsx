import type { RefObject } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportElementToPngDownload } from "@/lib/chart-export-png";
import { LatexFigureCopyButton } from "./LatexFigureCopyButton";

export interface FigureExportControlsProps {
  captureRef: RefObject<HTMLElement | null>;
  slug: string;
  caption: string;
  experimentId?: string;
  /** Default matches LaTeX: figures/{slug}.png */
  imagePath?: string;
  /**
   * Disables the PNG export when the chart isn't ready (still loading, no data,
   * etc.). The LaTeX copy button stays enabled because it doesn't read DOM.
   */
  pngDisabled?: boolean;
  /** Optional title override for the PNG button when disabled. */
  pngDisabledReason?: string;
}

export function FigureExportControls({
  captureRef,
  slug,
  caption,
  experimentId,
  imagePath,
  pngDisabled = false,
  pngDisabledReason,
}: FigureExportControlsProps) {
  const handlePng = async () => {
    const el = captureRef.current;
    if (!el) {
      toast.error("Chart is not ready to export yet.");
      return;
    }
    try {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await exportElementToPngDownload(el, { fileBaseName: slug });
      toast.success("Figure PNG downloaded (use the same name in figures/ for LaTeX)");
    } catch (err) {
      console.error(err);
      toast.error("Could not export figure. Try again after the chart finishes loading.");
    }
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
      <LatexFigureCopyButton slug={slug} caption={caption} experimentId={experimentId} imagePath={imagePath} />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pngDisabled}
        className="h-8 shrink-0 gap-1.5 px-2 text-[11px] font-medium text-[#737373] hover:bg-[#f5f5f5] hover:text-[#0a0a0a] disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => void handlePng()}
        aria-label="Download figure as PNG"
        title={
          pngDisabled
            ? pngDisabledReason ?? "Chart isn't ready to export yet."
            : "Downloads a high-resolution PNG of the chart below. Save it under figures/ using the same base name as in the LaTeX snippet."
        }
      >
        <Download className="h-3.5 w-3.5" aria-hidden />
        PNG
      </Button>
    </div>
  );
}
