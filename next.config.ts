import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Secrets are read only in server code via process.env and are never prefixed with
  // NEXT_PUBLIC_, so they are never bundled for the browser.
  images: {
    /**
     * Blog cover images come from Sanity's asset CDN, and routing them through next/image is a
     * cost decision as much as a performance one: Next resizes once and caches the result, so
     * repeat views do not re-fetch from Sanity. Asset bandwidth counts against the free plan's
     * quota — see docs/plan/T2-blog.md.
     *
     * Product images are NOT listed here. They come from Sapo's CDN and are still rendered with
     * plain <img>; adding them would change how every product tile loads, which belongs in its own
     * change rather than riding along with the blog.
     */
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.sanity.io",
        port: "",
        pathname: "/images/73i5sv8l/**",
        search: "",
      },
    ],
  },
};

export default nextConfig;
