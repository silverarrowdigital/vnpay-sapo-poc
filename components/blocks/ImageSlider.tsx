"use client";

import { useCallback, useRef, useState } from "react";
import type { SliderAspect, SliderImage } from "@/lib/blocks";
import { sized, srcSet } from "./imageUrl";

/**
 * A horizontal slider built on CSS scroll-snap rather than a carousel library.
 *
 * The track is a real scroll container, so dragging, trackpad swipes and the arrow keys all work
 * for free, and the slides are laid out and visible before any JavaScript runs. The buttons only
 * nudge that scroll position; with JS disabled the slider degrades to something you can still
 * scroll by hand.
 */
const ASPECT: Record<SliderAspect, string> = {
  square: "1 / 1",
  "4-3": "4 / 3",
  "16-9": "16 / 9",
};

export default function ImageSlider({ images, aspect }: { images: SliderImage[]; aspect: SliderAspect }) {
  const trackRef = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);

  // Derive the current slide from the scroll offset. Reading scroll beats tracking it ourselves:
  // a drag, a keypress and a button press all land in the same place.
  const onScroll = useCallback(() => {
    const track = trackRef.current;
    if (track === null) return;
    const width = track.clientWidth;
    if (width === 0) return;
    setIndex(Math.round(track.scrollLeft / width));
  }, []);

  const goTo = useCallback((next: number) => {
    const track = trackRef.current;
    if (track === null) return;
    track.scrollTo({ left: next * track.clientWidth, behavior: "smooth" });
  }, []);

  if (images.length === 0) return null;
  const single = images.length === 1;

  return (
    <div
      className="slider"
      role="group"
      aria-roledescription="carousel"
      aria-label={`Thư viện ảnh, ${images.length} ảnh`}
    >
      <ul
        className="slider-track"
        ref={trackRef}
        onScroll={onScroll}
        style={{ ["--slide-aspect" as string]: ASPECT[aspect] }}
      >
        {images.map((image, i) => (
          <li
            key={`${image.url}-${i}`}
            className="slider-slide"
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} / ${images.length}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- remote Sanity CDN, no loader configured */}
            <img
              src={sized(image.url, 1024)}
              srcSet={srcSet(image.url, image.w)}
              sizes="(min-width: 720px) 688px, 100vw"
              alt={image.alt}
              width={image.w}
              height={image.h}
              // The first slide is what the reader sees, so it loads eagerly; the rest wait.
              loading={i === 0 ? "eager" : "lazy"}
            />
            {image.caption !== undefined && <p className="slider-caption">{image.caption}</p>}
          </li>
        ))}
      </ul>

      {!single && (
        <div className="slider-controls">
          <button
            type="button"
            className="slider-btn"
            onClick={() => goTo(Math.max(0, index - 1))}
            disabled={index === 0}
            aria-label="Ảnh trước"
          >
            ←
          </button>
          <p className="slider-count" aria-live="polite">
            {index + 1} / {images.length}
          </p>
          <button
            type="button"
            className="slider-btn"
            onClick={() => goTo(Math.min(images.length - 1, index + 1))}
            disabled={index === images.length - 1}
            aria-label="Ảnh sau"
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
