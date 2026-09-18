import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { THEME_INIT_SCRIPT, initTheme } from "@/lib/theme";
import { registerServiceWorker } from "@/lib/register-sw";
import { ArrangeModeProvider } from "@/lib/arrange-mode";
import { ArrangeToolbar } from "@/components/app/ArrangeToolbar";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">
          Page not found
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back
          home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "Turf Bookings & Sales — Booking, Billing & Reports" },
        {
          name: "description",
          content:
            "Calculate orders, generate numbered invoices with PDF receipts, track expenses and profit, and share bills on WhatsApp.",
        },
        { name: "author", content: "Lovable" },
        {
          property: "og:title",
          content: "Turf Bookings & Sales — Booking, Billing & Reports",
        },
        {
          property: "og:description",
          content:
            "Calculate orders, generate numbered invoices with PDF receipts, track expenses and profit, and share bills on WhatsApp.",
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "theme-color", content: "#eaf1fb" },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-title", content: "Turf Ledger" },
        { name: "twitter:site", content: "@Lovable" },
        {
          name: "twitter:title",
          content: "Turf Bookings & Sales — Booking, Billing & Reports",
        },
        {
          name: "twitter:description",
          content:
            "Calculate orders, generate numbered invoices with PDF receipts, track expenses and profit, and share bills on WhatsApp.",
        },
        {
          property: "og:image",
          content:
            "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/540049b6a8209cd9c1a66ed9b1052d96/id-preview-aa845ce5--0d24f33e-ff35-4103-8ead-9b0ab5416fd7.lovable.app-1787066503441.png",
        },
        {
          name: "twitter:image",
          content:
            "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/540049b6a8209cd9c1a66ed9b1052d96/id-preview-aa845ce5--0d24f33e-ff35-4103-8ead-9b0ab5416fd7.lovable.app-1787066503441.png",
        },
      ],
      links: [
        {
          rel: "stylesheet",
          href: appCss,
        },
        // Fonts are self-hosted via @fontsource-variable (bundled at build
        // time, imported in styles.css) rather than fetched from
        // fonts.googleapis.com at runtime — this app is offline-first, and
        // a render-blocking <link> to a remote Google Fonts URL stalls
        // first paint whenever there's no network, which is a real
        // possibility for a desktop business app that isn't always online.
        { rel: "icon", href: "/favicon.png", type: "image/png" },
        { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
        { rel: "manifest", href: "/manifest.webmanifest" },
      ],

      scripts: [{ children: THEME_INIT_SCRIPT }],
    }),
    shellComponent: RootShell,
    component: RootComponent,
    notFoundComponent: NotFoundComponent,
    errorComponent: ErrorComponent,
  },
);

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    initTheme();
    registerServiceWorker();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ArrangeModeProvider>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
        <ArrangeToolbar />
        <Toaster position="bottom-right" richColors />
      </ArrangeModeProvider>
    </QueryClientProvider>
  );
}
