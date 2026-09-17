import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const NEAR_EDGE_PX = 24;

/**
 * One floating round button, bottom-right on every tab: a down arrow that
 * jumps to the bottom of the page, which turns into an up arrow once you're
 * there so the same button brings you straight back to the top. Hidden
 * entirely on pages short enough that there's nothing to scroll.
 */
export function ScrollEdgeButton() {
  const [visible, setVisible] = useState(false);
  const [atBottom, setAtBottom] = useState(false);

  useEffect(() => {
    const update = () => {
      const scrollHeight = document.documentElement.scrollHeight;
      const viewport = window.innerHeight;
      const scrollTop = window.scrollY;

      const scrollable = scrollHeight - viewport > NEAR_EDGE_PX * 2;
      setVisible(scrollable);
      setAtBottom(scrollTop + viewport >= scrollHeight - NEAR_EDGE_PX);
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    // Content height can change without a scroll or window-resize event —
    // opening a Settings accordion section, a tab switch, a list growing as
    // data loads. ResizeObserver catches those instantly; the interval below
    // is just a safety net for anything it misses.
    const ro = new ResizeObserver(update);
    ro.observe(document.body);
    const interval = window.setInterval(update, 1000);

    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      ro.disconnect();
      window.clearInterval(interval);
    };
  }, []);

  if (!visible) return null;

  const goToEdge = () => {
    window.scrollTo({
      top: atBottom ? 0 : document.documentElement.scrollHeight,
      behavior: "smooth",
    });
  };

  return (
    <button
      type="button"
      onClick={goToEdge}
      aria-label={atBottom ? "Scroll to top" : "Scroll to bottom"}
      title={atBottom ? "Scroll to top" : "Scroll to bottom"}
      className={cn(
        "frost fixed right-4 z-30 grid size-12 place-items-center rounded-full border shadow-lg transition-all active:scale-95",
        "bottom-24 md:bottom-6",
      )}
    >
      {atBottom ? (
        <ChevronUp className="size-5" />
      ) : (
        <ChevronDown className="size-5" />
      )}
    </button>
  );
}
