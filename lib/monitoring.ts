// Crash and error reporting (Sentry, Nov 14). Native crashes and uncaught JS
// errors are reported automatically once init() has run; reportError() sends
// the unexpected failures we catch ourselves (an AI call that failed in an
// unknown way, a sync round that threw, a purchase error).
//
// Privacy (App Store label: "Crash Data", not linked to the user): no user
// id/email is attached, sendDefaultPii is off, console logs are not sent as
// breadcrumbs (some of ours print ids), and request breadcrumbs keep the path
// but drop query strings (Supabase filters carry ids). The Sentry project also
// has "Prevent storing of IP addresses" on.
//
// The DSN is public by design (it can only send events). No DSN = reporting
// off, so a build or checkout without one simply doesn't report.

import * as Sentry from '@sentry/react-native';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

export function initMonitoring(): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',
    sendDefaultPii: false,
    // Errors only — no performance tracing (keeps the free quota for crashes).
    tracesSampleRate: 0,
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === 'console') return null;
      const url = breadcrumb.data?.url;
      if (typeof url === 'string') {
        breadcrumb.data = { ...breadcrumb.data, url: url.split('?')[0] };
      }
      return breadcrumb;
    },
  });
}

// Wraps the root component so render crashes are reported (and the native
// side can attach screen context).
export const wrapRoot = Sentry.wrap;

export function reportError(error: unknown, where: string, extra?: Record<string, unknown>): void {
  if (!dsn) return;
  Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
    tags: { where },
    ...(extra ? { extra } : {}),
  });
}
