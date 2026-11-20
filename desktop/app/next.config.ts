import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopAppRoot = path.dirname(fileURLToPath(import.meta.url));
const nextConfig: NextConfig = {
  distDir: process.env.MOSAIC_NEXT_DIST_DIR || ".next",
  ...(process.env.MOSAIC_NEXT_TSCONFIG_PATH
    ? { typescript: { tsconfigPath: process.env.MOSAIC_NEXT_TSCONFIG_PATH } }
    : {}),
  turbopack: { root: desktopAppRoot },
  outputFileTracingRoot: desktopAppRoot,
  env: { NEXT_PUBLIC_MOSAIC_DESKTOP: "1" },
  serverExternalPackages: ["@napi-rs/canvas"],
  async redirects() {
    return [
      ...["projects", "contracts", "delta", "maps", "property-decks"].flatMap((feature) => [
        { source: `/${feature}`, destination: "/dashboard", permanent: true },
        { source: `/${feature}/:path*`, destination: "/dashboard", permanent: true },
      ]),
      { source: "/business-analysis", destination: "/it-projects", permanent: true },
      { source: "/business-analysis/:path*", destination: "/it-projects/:path*", permanent: true },
      { source: "/ba", destination: "/it-projects", permanent: true },
      { source: "/ba/:path*", destination: "/it-projects/:path*", permanent: true },
    ];
  },
};
export default nextConfig;
