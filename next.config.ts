import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Version-skew protection: a tab still running the previous build gets a
  // full reload on its next navigation instead of fetching chunks and Server
  // Actions that no longer exist ("This page couldn't load"). CI sets
  // GITHUB_SHA; NEXT_DEPLOYMENT_ID overrides.
  deploymentId: process.env.NEXT_DEPLOYMENT_ID || process.env.GITHUB_SHA?.slice(0, 7) || undefined,
  // Receipt photos go to a Server Action (app/assistant/actions.ts); the
  // browser downscales them to ~1600 px first, and the action caps files at 5 MB.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
