// Crash and error reporting (Sentry, Nov 14). Native crashes and uncaught JS
// errors are reported automatically; reportError() sends the unexpected
// failures we catch ourselves (an AI call that failed in an unknown way, a
// sync round that threw, a purchase error).
//
// Initialised when this module is first imported — app/_layout.tsx imports it
// FIRST, so even a crash while the other modules load is caught.
//
// Privacy (App Store label: "Crash Data", not linked to the user): no user
// id/email is attached and sendDefaultPii is off; no performance tracing (it
// adds tracking headers to every request) and no session tracking; console
// logs are not sent (some of ours print ids); URLs in breadcrumbs lose their
// query (photo access tokens, Supabase filters) and any UUID (meal-photo paths
// carry the user's id); native network breadcrumbs are off (the JS scrubber
// can't see them); the device name is dropped. The Sentry org also has
// "prevent storing IP addresses" and the default scrubbers on.
//
// The DSN is public by design (it can only send events). No DSN = reporting
// off. Dev builds don't report unless EXPO_PUBLIC_SENTRY_DEV=1 (a test).

import * as Sentry from '@sentry/react-native';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
const enabled = !!dsn && (!__DEV__ || process.env.EXPO_PUBLIC_SENTRY_DEV === '1');

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function scrubBreadcrumb(b: Sentry.Breadcrumb): Sentry.Breadcrumb {
  if (b.data) {
    const { 'http.query': _query, 'http.fragment': _fragment, ...data } = b.data;
    if (typeof data.url === 'string') data.url = data.url.split(/[?#]/)[0].replace(UUID, ':id');
    b.data = data;
  }
  return b;
}

if (enabled) {
  Sentry.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',
    sendDefaultPii: false,
    enableAutoSessionTracking: false,
    // Passed through to the native SDK (not in the JS option types).
    ...({ enableNetworkBreadcrumbs: false } as object),
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === 'console') return null;
      return scrubBreadcrumb(breadcrumb);
    },
    // Native breadcrumbs are merged in after beforeBreadcrumb: scrub them all.
    beforeSend(event) {
      event.breadcrumbs = event.breadcrumbs?.map(scrubBreadcrumb);
      if (event.contexts?.device) delete event.contexts.device.name;
      return event;
    },
  });
}

// Wraps the root layout (touch context for crash reports). Identity when
// reporting is off, so dev launches don't warn about wrap-before-init.
export const wrapRoot: typeof Sentry.wrap = enabled ? Sentry.wrap : c => c;

// Offline, timeouts and dropped connections are expected on phones — not bugs.
function isNetworkError(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? '';
  const message = (error as { message?: string })?.message ?? String(error);
  return name === 'FunctionsFetchError' || name === 'AbortError'
    || /network request failed|failed to fetch|timed? ?out|aborted|offline/i.test(message);
}

// The same failure is sent at most 3 times per launch (a stuck sync write is
// retried on every foreground; an AI outage would hit every call).
const MAX_PER_KIND = 3;
const sentCounts = new Map<string, number>();

export function reportError(error: unknown, where: string, extra?: Record<string, unknown>): void {
  if (!enabled || isNetworkError(error)) return;
  const err = error instanceof Error ? error : new Error(String(error));
  const kind = `${where}:${err.message}`;
  const sent = sentCounts.get(kind) ?? 0;
  if (sent >= MAX_PER_KIND) return;
  sentCounts.set(kind, sent + 1);
  Sentry.captureException(err, {
    tags: { where },
    ...(extra ? { extra } : {}),
  });
}
