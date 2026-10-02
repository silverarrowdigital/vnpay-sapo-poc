"use client";

import { useState } from "react";
import type { VideoProvider } from "@/lib/blocks";
import { sized } from "./imageUrl";

/**
 * A video, loaded only when the reader asks for it.
 *
 * Two things this deliberately does:
 *
 * 1. **The player URL is assembled here, from an enum and an id.** The schema has no URL field
 *    and no HTML field (sanity/schemas/blocks/index.ts), so there is no string an editor could
 *    type that points this iframe at another origin. See CLAUDE.md security rules.
 * 2. **Click to load.** Until the reader presses play there is no iframe, so no request reaches
 *    YouTube or Vimeo and they set no cookies on someone who never watched anything.
 */
const EMBED: Record<VideoProvider, (id: string) => string> = {
  // youtube-nocookie is YouTube's own reduced-tracking host for embeds.
  youtube: (id) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1`,
  vimeo: (id) => `https://player.vimeo.com/video/${encodeURIComponent(id)}?autoplay=1`,
};

export default function VideoEmbed({
  provider,
  videoId,
  title,
  poster,
}: {
  provider: VideoProvider;
  videoId: string;
  title: string;
  poster?: string | null;
}) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <div className="video">
        <iframe
          className="video-frame"
          src={EMBED[provider](videoId)}
          title={title}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <div className="video">
      <button type="button" className="video-cover" onClick={() => setPlaying(true)}>
        {poster ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote Sanity CDN, no loader configured
          <img src={sized(poster, 1024)} alt="" loading="lazy" />
        ) : null}
        <span className="video-play" aria-hidden="true">
          ▶
        </span>
        {/* The accessible name says what pressing this does, not just "play". */}
        <span className="video-label">Phát video: {title}</span>
      </button>
    </div>
  );
}
