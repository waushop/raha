import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Receipt photos go to a Server Action (app/assistant/actions.ts); the
  // browser downscales them to ~1600 px first, and the action caps files at 5 MB.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
