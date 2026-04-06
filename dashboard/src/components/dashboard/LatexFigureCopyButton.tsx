import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { buildLatexFigureSnippet, slugifyLatexLabel } from "@/lib/latex-export";

export interface LatexFigureCopyButtonProps {
  /** Short unique id for file name and \\label (e.g. `sharpe-returns-mean-by-strategy`). */
  slug: string;
  /** Chart title for the LaTeX \\caption. */
  caption: string;
  experimentId?: string;
  /** Default: `figures/{slug}.png` (slug normalized; matches PNG download). */
  imagePath?: string;
}

export function LatexFigureCopyButton({
  slug,
  caption,
  experimentId,
  imagePath,
}: LatexFigureCopyButtonProps) {
  const labelSlug = slugifyLatexLabel(slug);
  const path = imagePath ?? `figures/${labelSlug}.png`;
  const captionWithExperiment = experimentId
    ? `${caption} (Experiment ${experimentId}).`
    : `${caption}.`;

  const handleClick = async () => {
    const tex = buildLatexFigureSnippet({
      imagePath: path,
      caption: captionWithExperiment,
      label: labelSlug,
    });
    const clipboardText =
      typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)
        ? tex.replace(/\n/g, "\r\n")
        : tex;
    try {
      await navigator.clipboard.writeText(clipboardText);
      toast.success("LaTeX figure snippet copied");
    } catch {
      toast.error("Could not copy (clipboard blocked). Use HTTPS or copy manually.");
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 shrink-0 gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9b938b] hover:bg-[rgba(0,0,0,0.04)] hover:text-[#5f5955]"
      onClick={handleClick}
      aria-label="Copy LaTeX figure snippet"
      title={`Copies a figure environment (\\includegraphics uses a % line break before {${path}} for editor-friendly LaTeX). Download the PNG next to it and save under figures/ with the same file name, or edit the path after pasting.`}
    >
      <Copy className="h-3.5 w-3.5" aria-hidden />
      LaTeX
    </Button>
  );
}
