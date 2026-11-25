'use client';

/** Native CSS scroll-snap carousel: touch-swipe works without a JS carousel library. */
import { useRef, useState } from 'react';

export function FlyerSlideshow({ images, title }: { images: string[]; title: string }) {
  const slides = images.slice(0, 8); // shared MAX_SLIDESHOW_IMAGES
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  if (slides.length === 0) return null;

  const goTo = (index: number) => {
    const track = trackRef.current;
    const slide = track?.children[index] as HTMLElement | undefined;
    if (!track || !slide) return;
    track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior: 'smooth' });
    setActive(index);
  };

  return (
    <section aria-label={`${title} flyer images`}>
      <div
        className="pub-slides"
        ref={trackRef}
        onScroll={(event) => {
          const track = event.currentTarget;
          const width = track.firstElementChild?.clientWidth ?? track.clientWidth;
          setActive(Math.min(slides.length - 1, Math.max(0, Math.round(track.scrollLeft / Math.max(1, width)))));
        }}
        tabIndex={0}
      >
        {slides.map((url, index) => (
          <div className="pub-slide" key={`${url}-${index}`}>
            <img
              src={url}
              alt={`${title} flyer, image ${index + 1} of ${slides.length}`}
              loading={index === 0 ? 'eager' : 'lazy'}
              decoding="async"
            />
          </div>
        ))}
      </div>
      {slides.length > 1 ? (
        <>
          <div className="pub-slide-dots" aria-label="Choose flyer image">
            {slides.map((_, index) => (
              <button
                type="button"
                key={index}
                className={`pub-dot ${active === index ? 'pub-dot-active' : ''}`}
                aria-label={`Show flyer image ${index + 1}`}
                aria-current={active === index ? 'true' : undefined}
                onClick={() => goTo(index)}
              >
                {index + 1}
              </button>
            ))}
          </div>
          <p className="yv-tiny yv-muted">Swipe or use the numbered buttons to see all {slides.length} images.</p>
        </>
      ) : null}
    </section>
  );
}
