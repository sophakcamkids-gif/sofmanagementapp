import React, { useLayoutEffect, useRef, useState } from 'react';

interface FitToWidthProps {
  /** The width the child is designed for (px). The child is never scaled up. */
  designWidth: number;
  children: React.ReactNode;
}

// Shrinks fixed-width content (a report sheet) to fit the viewport WITHOUT
// reflowing it — the layout stays pixel-identical, just zoomed out, the way a
// PDF looks on a phone. On wide screens (scale ≥ 1) nothing changes. The
// transform/sizing is reset for export/print via the .rc-fit-* classes.
export default function FitToWidth({ designWidth, children }: FitToWidthProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; w: number | string; h: number | undefined }>({
    scale: 1, w: '100%', h: undefined,
  });

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const update = () => {
      const availW = outer.clientWidth;
      const s = Math.min(1, availW / designWidth);
      if (s >= 1) setFit({ scale: 1, w: '100%', h: undefined });
      else setFit({ scale: s, w: Math.ceil(designWidth * s), h: Math.ceil(inner.offsetHeight * s) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(outer);
    ro.observe(inner);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, [designWidth]);

  return (
    <div ref={outerRef} className="rc-fit-outer w-full">
      <div
        className="rc-fit-frame"
        style={{ width: fit.w, height: fit.h, margin: '0 auto', overflow: fit.scale < 1 ? 'hidden' : undefined }}
      >
        <div
          ref={innerRef}
          className="rc-fit-inner"
          style={{ width: designWidth, transformOrigin: 'top left', transform: fit.scale < 1 ? `scale(${fit.scale})` : undefined }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
