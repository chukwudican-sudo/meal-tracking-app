---
name: Signup OTP Code Verification
overview: Replace the unreliable tap-the-link signup confirmation with a reusable 6-digit code entry screen, verified via supabase.auth.verifyOtp(type:'signup'), reachable both right after signup and later from the Home banner, while preserving the existing deferred/offline-first pendingEmailVerification behavior. Password reset, magic link, and Google/Apple flows are untouched.
todos:
  - id: verify-otp-helper
    content: Add verifySignupOtp(email, token) wrapper to lib/auth.tsx calling supabase.auth.verifyOtp with type 'signup'
    status: completed
  - id: code-component
    content: Build reusable components/auth/EmailCodeVerification.tsx (6-digit oneTimeCode input, verify, resend with cooldown, optional skip)
    status: completed
  - id: onboarding-swap
    content: Replace AccountStep's verificationSent link messaging in app/onboarding.tsx with EmailCodeVerification (onVerified + skip both call onContinue)
    status: completed
  - id: standalone-route
    content: Add app/auth/verify-code.tsx standalone route and register it in app/_layout.tsx
    status: completed
  - id: banner-cta
    content: Update EmailVerificationBanner to open /auth/verify-code instead of resending inline
    status: completed
isProject: false
---

## What relies on the callback screen (confirmed)

Only signup uses [app/auth/callback.tsx](app/auth/callback.tsx). Password reset has its own separate screen [app/auth/reset.tsx](app/auth/reset.tsx) (deep link `mealapp://auth/reset`); Google/Apple are `comingSoon()` stubs; there is no magic-link flow. So this change is isolated to signup. `exchangeCodeFromUrl` in [lib/auth.tsx](lib/auth.tsx) and `auth/callback.tsx` are left in place and untouched (reset still uses `exchangeCodeFromUrl`; the callback route just stops being the signup mechanism).

## Required manual dashboard step (not code)

`verifyOtp` reads the 6-digit token from the "Confirm signup" email, so that template must render `{{ .Token }}`. Currently it almost certainly uses `{{ .ConfirmationURL }}` (the link). In Dashboard - Authentication - Email Templates - "Confirm signup", add the code, e.g. `Your verification code is {{ .Token }}`. Without this, the email contains no code and every verify attempt fails.

## OTP expiry value

Repo config declares `otp_expiry = 3600` (1 hour) with `otp_length = 6` in [supabase/config.toml](supabase/config.toml). That file has drifted from the hosted project (it also says `enable_confirmations = false`, which is not what production does), so treat the authoritative value as Dashboard - Authentication - Providers - Email - "Email OTP Expiration" (Supabase default 3600s = 1 hour). Net: a code is valid for 1 hour unless changed there.

## Changes

### 1. New auth helper - [lib/auth.tsx](lib/auth.tsx)
Add alongside the other wrappers:
```ts
export async function verifySignupOtp(email: string, token: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.verifyOtp({ email: email.trim(), token: token.trim(), type: 'signup' });
  if (error) return { error: error.message };
  return { error: null, userId: data.user?.id };
}
```
On success this creates a confirmed session -> the existing `AuthProvider` effect clears `pendingEmailVerification` + pending password, and `SyncProvider` reconciles. No other downstream wiring needed.

### 2. New reusable component - `components/auth/EmailCodeVerification.tsx`
Presentational + logic, so it works both in the wizard and standalone. Props: `email`, `onVerified: () => void`, optional `onSkip?: () => void` + `skipLabel?`.
- Single 6-digit `TextInput`: `textContentType="oneTimeCode"`, `autoComplete="one-time-code"`, `keyboardType="number-pad"`, `maxLength={6}`.
- "Verify" button -> `verifySignupOtp(email, code)`; on success `onVerified()`, on failure set an inline error string (no navigation reset).
- "Resend code" -> existing `resendVerificationEmail(email)` from [lib/auth.tsx](lib/auth.tsx), reusing its `retryAfterSeconds` and a local countdown (same pattern already in [components/EmailVerificationBanner.tsx](components/EmailVerificationBanner.tsx), `RESEND_COOLDOWN_SECONDS = 60`) so it honors the `max_frequency` min-interval throttle.
- Optional skip row when `onSkip` provided.

### 3. Onboarding - [app/onboarding.tsx](app/onboarding.tsx) `AccountStep`
Replace the `verificationSent` "Check your email... tap it" block (currently approx lines 808-820) with:
```tsx
<EmailCodeVerification email={email} onVerified={onContinue} onSkip={onContinue} skipLabel="I'll verify later" />
```
Both paths call the existing `onContinue` (advances the wizard, exactly as the current Continue button does); verified users additionally now have a real session. Preserves the deferred/offline-first path.

### 4. New standalone route - `app/auth/verify-code.tsx`
Thin wrapper: reads `email` from `useMealStore(s => s.profile.email)`, renders `EmailCodeVerification` with `onVerified` -> toast + `router.back()`, and a back/close that just dismisses (deferred access preserved). Register it in [app/_layout.tsx](app/_layout.tsx)'s `Stack` next to the other `auth/*` screens.

### 5. Home banner - [components/EmailVerificationBanner.tsx](components/EmailVerificationBanner.tsx)
Change the primary action from inline "Resend email" to opening the code screen: `router.push('/auth/verify-code')` (resend now lives on that screen). Banner text becomes e.g. "Verify your email" / "Enter verification code". `pendingEmailVerification` and the offline-first access it grants stay exactly as-is.

## Explicitly not touched
`exchangeCodeFromUrl`, `app/auth/callback.tsx`, `app/auth/reset.tsx`, password reset, Google/Apple stubs, and the `pendingEmailVerification` machinery (only the banner's tap target changes).

## Todos
