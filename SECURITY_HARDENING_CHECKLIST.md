# Security Hardening Checklist

This checklist tracks practical hardening tasks for auth, logging, and admin password reset flows.

## Auth And Session

- [x] Remove JWT fallback default values.
- [x] Enforce startup failure if `JWT_SECRET` is missing.
- [x] Stop accepting bearer tokens from query parameters.
- [ ] Add token revocation strategy (logout all sessions / compromised account).
- [ ] Add refresh token rotation with reuse detection.
- [x] Add login and password-reset request rate limiting per IP and per account.
- [x] Add account lockout/backoff after repeated failed login attempts.
- [x] Add security response headers (`helmet`).
- [ ] Tune `helmet`'s default CSP policy explicitly (currently using helmet defaults).

## Input And Content Safety

- [x] Sanitize document preview HTML before rendering.
- [x] Escape CSV cell values before building HTML table previews.
- [ ] Add server-side MIME allowlist for uploads.
- [ ] Add file content signature checks for risky file types.
- [ ] Add malware scanning pipeline for uploaded files.

## Messaging Data Integrity

- [x] Require exactly one target (`channelId` xor `recipientId`) for message create/upload.
- [x] Block self-directed direct message targets on upload route.
- [ ] Add DB-level check constraint for message target validity.

## Logging And Privacy

- [ ] Remove plaintext logging of full request bodies and message payloads.
- [ ] Replace ad hoc logs with structured logger calls and field-level redaction.
- [ ] Add environment-based log levels and disable debug logs in production.
- [ ] Add audit events for admin actions (role changes, password resets, user deletes).

## Admin Password Reset Flow

- [ ] Stop returning temporary passwords in API responses.
- [ ] Use one-time reset links with short expiry instead of shareable passwords.
- [ ] Add mandatory admin reason for reset and store it in audit trail.
- [ ] Notify users on security events with geo/IP/session metadata.
- [ ] Add forced password reset expiry window and one-time use enforcement.

## Verification

- [ ] Add tests for auth middleware (missing/invalid token behavior).
- [ ] Add tests for message target validation on post/upload endpoints.
- [ ] Add tests for document preview sanitization behavior.
- [ ] Add SAST/dependency scanning in CI.
