# Changelog

All notable changes to `@amjadiqbal/firebase-auth-tanstack-start` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-23

First release.

### Added
- `createFirebaseAuth()` (`/server`): verifies Firebase session cookies and bearer ID tokens, returns a typed `FirebaseUser` with custom claims; `authenticate()`, `getUser()`, `middleware()` for a Start request middleware, `requireUser()`, `loginHandler()`, `logoutHandler()` and `verifyAppCheck()`.
- `restBackend()` (`/server`): verification with Web Crypto (`jose`) against Google's public keys, and the Identity Toolkit REST API for session cookies, revocation and revocation checks, with a service account or the Auth Emulator. No `firebase-admin`.
- `firebaseAdminBackend()` (`/admin`): the same through `firebase-admin`.
- `requireAuth()` (`.`): a `beforeLoad` guard with redirect, claim check and forbidden redirect.
- `firebaseAuthErrorAdapter` (`.`): a Start serialization adapter that keeps `FirebaseAuthError` codes across server functions.
- `useFirebaseUser()` (`/react`): keeps the server session in step with the browser's Firebase sign-in, including custom claim changes.
- App Check token verification.
