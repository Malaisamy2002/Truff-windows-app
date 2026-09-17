/**
 * Guarded service-worker registration.
 *
 * Offline caching must never activate in dev, inside an iframe, or on Lovable
 * preview hosts — a stale cached shell there would keep serving deleted chunks.
 * `?sw=off` acts as a kill switch that unregisters an already-installed worker.
 */

import { isDesktop } from "./desktop";

const SW_URL = "/sw.js";

function isLovablePreviewHost(hostname: string) {
  const previewHosts = [
    "lovableproject.com",
    "lovableproject-dev.com",
    "beta.lovable.dev",
  ];
  return previewHosts.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

function shouldRegister() {
  if (typeof window === "undefined") return false;
  // The desktop build has no service worker asset at all — see vite.config.ts,
  // where VitePWA is excluded from that build target — but this guard also
  // protects a Tauri window that somehow loads a bundle built with the SW
  // included (e.g. someone points the shell at the hosted site by mistake).
  if (isDesktop()) return false;
  if (!import.meta.env.PROD) return false;
  if (window.self !== window.top) return false;
  const { hostname, search } = window.location;
  if (hostname.startsWith("id-preview--") || hostname.startsWith("preview--"))
    return false;
  if (isLovablePreviewHost(hostname)) return false;
  if (
    new URLSearchParams(search).has("sw") &&
    new URLSearchParams(search).get("sw") === "off"
  )
    return false;
  return true;
}

async function unregisterAppWorkers() {
  if (!("serviceWorker" in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.allSettled(
    regs
      .filter((r) =>
        (r.active?.scriptURL ?? r.installing?.scriptURL ?? "").endsWith(SW_URL),
      )
      .map((r) => r.unregister()),
  );
}

export function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
    return;

  if (!shouldRegister()) {
    void unregisterAppWorkers();
    return;
  }

  void navigator.serviceWorker.register(SW_URL, { scope: "/" }).catch(() => {
    /* offline support is best-effort */
  });
}
