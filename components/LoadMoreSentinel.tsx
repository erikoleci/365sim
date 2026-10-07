import React from 'react';

// Shown under a long list that is rendered in slices. When it scrolls into view
// (a little before the user reaches the bottom) it asks for the next slice, so the
// page never has to build hundreds of match rows at once -- the cause of the
// freeze when switching from "Live In-Play" to the full football list. The button
// is the fallback if IntersectionObserver is unavailable.
const LoadMoreSentinel: React.FC<{ remaining: number; onMore: () => void }> = ({ remaining, onMore }) => {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const onMoreRef = React.useRef(onMore);
  onMoreRef.current = onMore;

  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onMoreRef.current();
    }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
    // Re-arm after each slice: a new `remaining` means the sentinel may still be in view.
  }, [remaining]);

  return (
    <div ref={ref} className="flex justify-center py-4">
      <button
        onClick={onMore}
        className="text-xs font-bold uppercase tracking-wider text-brand-yellow bg-brand-panel border border-brand-divider rounded-full px-5 py-2 hover:bg-[#444] transition-colors"
      >
        Shfaq më shumë ({remaining})
      </button>
    </div>
  );
};

export default LoadMoreSentinel;
