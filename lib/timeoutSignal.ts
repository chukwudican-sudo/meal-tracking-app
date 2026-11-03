// An AbortSignal that fires after `ms`. React Native has no
// AbortSignal.timeout (its AbortSignal polyfill lacks the static), so build it
// from an AbortController. Call done() when the request settles.
export function timeoutSignal(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

// Rejects after `ms` if `p` hasn't settled (for calls that take no signal).
export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}
