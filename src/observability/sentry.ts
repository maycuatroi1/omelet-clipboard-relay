// Pure Sentry `beforeSend` scrubber. Step 11 will install @sentry/bun and wire
// this into `Sentry.init({ beforeSend })`. Until then this is a pure function
// that takes a_hint-shaped event and returns a hint-shaped event - no I/O, no
// global state, easy to test directly.
//
// Invariant `no-payload-logging`: Sentry events are error reports, so the
// denylist is the payload-bearing field names that might slip in via
// `Sentry.captureException(err, { extra: ... })`, breadcrumbs, the HTTP
// request body, or stack-trace frame vars. We replace the *value* with
// `__REDACTED__` rather than deleting the key, so a glance at the event
// shows that something was scrubbed.

const SCRUB_KEYS: ReadonlySet<string> = new Set(["payload", "ciphertext", "body", "bytes"]);

const REDACTED = "__REDACTED__";

// Hint-shaped Sentry event. We intentionally use a structural shape rather
// than importing @sentry/bun types (not a runtime dep yet). Any field we do
// not recognise is passed through untouched.
export interface SentryEvent {
  extra?: Record<string, unknown>;
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown> }>;
  request?: { body?: unknown; [key: string]: unknown };
  exception?: {
    values?: Array<{
      stacktrace?: {
        frames?: Array<{ vars?: Record<string, unknown> }>;
      };
    }>;
  };
  [key: string]: unknown;
}

function scrubRecord(record: Record<string, unknown> | undefined): void {
  if (!record) return;
  for (const key of Object.keys(record)) {
    if (SCRUB_KEYS.has(key)) {
      record[key] = REDACTED;
    }
  }
}

export function beforeSend(event: SentryEvent): SentryEvent {
  if (event.extra) scrubRecord(event.extra);

  if (Array.isArray(event.breadcrumbs)) {
    for (const crumb of event.breadcrumbs) {
      if (crumb.data) scrubRecord(crumb.data);
      if (typeof crumb.message === "string") {
        crumb.message = scrubBreadcrumbMessage(crumb.message);
      }
    }
  }

  // request.body is the HTTP request body - always redact regardless of
  // value. A clipboard chunk rides in here during an Oauth/refresh call or
  // a malformed POST.
  if (event.request?.body !== undefined) {
    event.request.body = REDACTED;
  }

  const frames = event.exception?.values ?? [];
  for (const ex of frames) {
    const traceFrames = ex.stacktrace?.frames ?? [];
    for (const frame of traceFrames) {
      if (frame.vars) scrubRecord(frame.vars);
    }
  }

  return event;
}

// A breadcrumb message like "got payload: <base64>" or "bytes=AAAA" is the
// other common leak vector. Replace any `key=value` or `key: value` token
// whose key is on the denylist.
function scrubBreadcrumbMessage(message: string): string {
  return message.replace(
    /\b(payload|ciphertext|body|bytes)\b\s*[:=]\s*\S+/g,
    (_match, key: string) => `${key}=${REDACTED}`,
  );
}

export default beforeSend;
