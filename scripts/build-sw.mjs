// Generates the service worker AFTER the nitro build finishes, directly
// against .output/public — the directory that's actually deployed.
//
// Why this exists: vite-plugin-pwa's `generateSW` strategy globs the build
// output and writes sw.js during the client build's closeBundle hook. But
// this project's nitro/cloudflare-module preset only assembles the real,
// deployable static directory (.output/public) *after* all vite build
// passes finish — so at the point vite-plugin-pwa looks for files to
// precache, .output/public doesn't exist yet. The plugin was writing an
// empty-precache sw.js into a top-level dist/ folder that nitro never
// serves, so the service worker registered by src/lib/register-sw.ts at
// "/sw.js" was 404ing in production. Running workbox-build's generateSW
// here, after `vite build` (which includes the nitro step) completes,
// fixes both problems in one place.
import { generateSW } from "workbox-build";
import { existsSync } from "node:fs";

const PUBLIC_DIR = ".output/public";

if (!existsSync(PUBLIC_DIR)) {
  console.error(
    `[build-sw] ${PUBLIC_DIR} not found — run \`vite build\` first.`,
  );
  process.exit(1);
}

const { count, size, warnings } = await generateSW({
  swDest: `${PUBLIC_DIR}/sw.js`,
  globDirectory: PUBLIC_DIR,
  globPatterns: ["**/*.{js,css,ico,png,svg,woff2}"],
  navigateFallbackDenylist: [/^\/~oauth/, /^\/api\//],
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  skipWaiting: true,
  runtimeCaching: [
    {
      urlPattern: ({ request }) => request.mode === "navigate",
      handler: "NetworkFirst",
      options: {
        cacheName: "html-navigations",
        networkTimeoutSeconds: 5,
        expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 7 },
      },
    },
    {
      urlPattern: ({ url, sameOrigin }) =>
        sameOrigin && /\.(?:js|css|woff2|png|svg|ico)$/.test(url.pathname),
      handler: "CacheFirst",
      options: {
        cacheName: "static-assets",
        expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
      },
    },
  ],
});

for (const warning of warnings) console.warn(`[build-sw] ${warning}`);
console.log(
  `[build-sw] wrote ${PUBLIC_DIR}/sw.js — precached ${count} files, ${(size / 1024).toFixed(1)} KiB`,
);
