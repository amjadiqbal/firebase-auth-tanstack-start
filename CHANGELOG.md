# Changelog

All notable changes to `@amjadiqbal/firebase-auth-tanstack-start` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.2] - 2026-10-23

Fixes from a README-versus-code audit of 0.1.1.

### Changed
- Default backend and App Check: a token whose `kid` is not in the cached key set now triggers one early key download (at most once a minute per key URL), so tokens signed with freshly rotated Google keys are accepted instead of refused until the cache expires.
- `engines.node` is now `>=22.12`, TanStack Start's own minimum (it said `>=20.19`, which Start does not support).

### Added
- `npm run test:emulator`: 10 integration tests of both backends against the Firebase Auth Emulator (verify, session cookies, custom claims, revocation, disabled and deleted users). Local CI now also runs the unit tests on Node 22.

### Docs
- What the `/server` entry needs at runtime (Start's server runtime uses `node:async_hooks`), corrected from "imports no Node modules".
- `checkRevoked` and revocation need `serviceAccount` only with the default backend (no Application Default Credentials); firebase-admin uses its own credentials.
- `clockToleranceSeconds`, `serviceAccount` and `emulatorHost` apply to the default backend only.
- Key caching rules; App Check limits (no replay protection, no clock tolerance, always the package's verifier, checked before the login body).
- `allowedOrigins` replaces the default origin; a failed revoke still deletes the cookie; `signOut()` still signs the browser out when the logout call fails.

## [0.1.1] - 2026-10-23

First published release. Version 0.1.0 was tagged but never published to npm.

### Fixed
- `firebaseAuthErrorAdapter` has an explicit type, so the type declarations import TanStack Router's types instead of bundling a 120 kB copy of them.

## [0.1.0] - 2026-10-23 (not published)

### Added
- `createFirebaseAuth()` (`/server`): verifies Firebase session cookies and bearer ID tokens, returns a typed `FirebaseUser` with custom claims; `authenticate()`, `getUser()`, `middleware()` for a Start request middleware, `requireUser()`, `loginHandler()`, `logoutHandler()` and `verifyAppCheck()`.
- `restBackend()` (`/server`): verification with Web Crypto (`jose`) against Google's public keys, and the Identity Toolkit REST API for session cookies, revocation and revocation checks, with a service account or the Auth Emulator. No `firebase-admin`.
- `firebaseAdminBackend()` (`/admin`): the same through `firebase-admin`.
- `requireAuth()` (`.`): a `beforeLoad` guard with redirect, claim check and forbidden redirect.
- `firebaseAuthErrorAdapter` (`.`): a Start serialization adapter that keeps `FirebaseAuthError` codes across server functions.
- `useFirebaseUser()` (`/react`): keeps the server session in step with the browser's Firebase sign-in, including custom claim changes.
- App Check token verification.
