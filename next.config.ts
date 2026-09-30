import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Nothing custom needed for the MVP. Secrets are read only in server code via process.env
  // and are never prefixed with NEXT_PUBLIC_, so they are never bundled for the browser.
};

export default nextConfig;
