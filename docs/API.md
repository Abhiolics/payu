# API contract

Base URL: `http://localhost:5003/api`. The new Postman collection and `openapi.json` describe requests. The source collection contains no response examples; these response contracts are newly defined and must be used by your frontend adapter.

## Authentication and common responses

Public: registration, login, email verification/resend, app settings, enabled payment methods, and contacts. All remaining endpoints require a bearer token. Routes under `/admin`, or containing `/admin`, require role `admin` as well. Tokens are random opaque session credentials, not JWTs. User status is checked from the database on every authenticated request.

```json
{
  "success": true,
  "data": {
    "token": "<64-character session token>",
    "tokenType": "Bearer",
    "expiresIn": 86400,
    "user": {
      "id": "<24-character ID>",
      "_id": "<same ID>",
      "fullName": "Example User",
      "email": "user@example.test",
      "phoneNumber": "9000000000",
      "role": "user",
      "isVerified": true,
      "isBlocked": false,
      "isActive": true,
      "createdAt": "2026-09-11T00:00:00.000Z",
      "updatedAt": "2026-09-11T00:00:00.000Z"
    }
  }
}
```

Errors:

```json
{
  "success": false,
  "error": { "code": "INSUFFICIENT_BALANCE", "message": "Insufficient wallet balance" },
  "requestId": "<request UUID>"
}
```

Validation errors also contain `error.details`, an array of `path` and `message`. HTTP status: 400 invalid verification/JSON; 401 invalid session/credentials; 403 denied role/account; 404 missing or unowned object; 409 duplicate/insufficient funds/conflicting state; 413 oversize upload; 422 invalid fields; 429 throttled; 503 maintenance; 500 unexpected server/database failure. Creation normally returns 201; login returns 200.

## Lists and filters

```json
{
  "success": true,
  "data": {
    "items": [],
    "pagination": { "page": 1, "limit": 20, "total": 0, "pages": 0 }
  }
}
```

List endpoints accept `page` (default 1), `limit` (default 20, maximum 100), `from` and `to` (ISO timestamps). Ordering is descending creation time then ID. Pagination totals and items are separate queries and can reflect concurrent changes.

`status=pending|approved|rejected` filters deposits, withdrawals, and task submissions. Admin financial lists also accept `userId`. User lists are always scoped to the signed-in user regardless of query input. `search` works on admin users (name/email/phone) and admin catalogue lists (name/title/code/label). Unknown query fields are ignored; unsupported filters are not applied. Date ranges and parameters are validated; malformed values return 422.

## Entity fields

All entity IDs are 24 hexadecimal characters. `id` and `_id` are aliases for frontend compatibility. Timestamps are UTC ISO strings. JSON fields use camelCase. Internal password hashes and encrypted storage fields are never included.

| Entity / response | Data fields |
|---|---|
| User | id, _id, fullName, email, phoneNumber, role, isVerified, isBlocked, isActive, createdAt, updatedAt |
| Plan | id, _id, name, amount, description, isActive, createdAt, updatedAt |
| Gift code (admin) | id, _id, code, rewardAmount, maxUsers, expiryDate, usedCount, isActive, createdAt, updatedAt |
| Task | id, _id, title, description, rewardAmount, isActive, createdAt, updatedAt |
| Contact | id, _id, type, label, value, isActive, createdAt, updatedAt |
| Wallet | userId, balancePaise (integer string), balance (rupees) |
| Deposit | id, _id, userId, planId, amountPaise, amount, transactionRef, proofId, proofUrl, status, reason, reviewedBy, reviewedAt, createdAt |
| Withdrawal | id, _id, userId, amountPaise, amount, bankDetails, status, reason, payoutRef, reviewedBy, reviewedAt, createdAt |
| Submission | id, _id, userId, taskId, proofId, proofUrl, rewardPaise, rewardAmount, status, reason, reviewedBy, reviewedAt, createdAt |
| Ledger transaction | id, _id, userId, deltaPaise, balanceAfterPaise, sourceKey, description, actorId, createdAt, amount (absolute rupees), type (credit/debit), balanceAfter |
| Notification | id, _id, userId, title, message, isRead, createdAt |
| Audit entry | id, _id, actorId, action, entityId, requestId, createdAt |
| Admin user detail | user fields plus wallet |
| Gift redemption | redemptionId, wallet |
| Unread count | count |

Bigint paise fields from PostgreSQL are strings; ordinary catalogue amount inputs are retained as the submitted number/string. Display rupee amounts are numbers. Wallet balance is available balance, excluding amounts reserved by pending withdrawals. The reservation appears as a debit; a rejected withdrawal creates a compensating credit; approval creates no additional debit.

## Important request details

- Register: `fullName`, `phoneNumber` (10–15 digits, optional leading +), `email`, `password` (10–128 characters). No `role`, `balance`, or verified flags accepted.
- Login: `email`, `password`. Verification required. Logout invalidates only the current token.
- Update profile: `fullName` and/or `phoneNumber`. Email changes are not supported by this endpoint.
- Change password: `currentPassword`, `newPassword`; all sessions are revoked.
- Create/update plan: `name`, `amount`, `description`. The source omitted the create body; it now uses the update fields. Catalogue PUT requests replace the full catalogue data object; they are not partial PATCH updates.
- Create/update gift: `code`, `rewardAmount`, `maxUsers`, future `expiryDate`. Codes normalize to uppercase. A used code cannot be renamed, and capacity cannot be reduced below redemptions.
- Create/update task: `title`, `description`, `rewardAmount`.
- Deposit: multipart `planId`, `transactionRef`, `amount`, file `paymentProof`. Transaction references normalize to uppercase and are globally unique, including rejected requests.
- Withdrawal: `amount`, `bankDetails` with `accountHolderName`, `bankName`, `accountNumber`, `ifscCode`, optional `upiId`. No payment-provider operation occurs at submission.
- Reject deposit/withdrawal/submission: `{ "reason": "..." }` is required, even where missing from the source.
- Approve withdrawal: `{ "payoutRef": "bank-or-provider-reference" }` is required. Optional `reason` is accepted. Other approvals accept `{}` or optional `reason`.
- Wallet adjustment: `userId`, `amount`, `type` (`credit`/`debit`), `description` required. Only admins may adjust wallets.
- Gift redemption: `{ "code": "FESTIVE50" }`.
- Task submission: multipart file `proof`; no other body fields.

Financial creation, gift redemption, wallet adjustment and financial review requests require `Idempotency-Key` (8–128 letters, digits, underscores or hyphens). Keep it unchanged for an identical network retry. Reusing a key with different content returns 409. The original collection must be updated for these headers and the required rejection/payout fields; the included cleaned collection already has them.

## Settings and dashboard

Public `/app/settings` returns `maintenanceMode`, `maintenanceMessage`, `forceUpdate`, `updateMessage`, `currentVersion`. `/payment-methods` returns `qrCode` and `bankAccount`; disabled methods return only `{ "enabled": false }`. `/admin/settings` returns the complete settings document. Settings updates return that same complete document.

`/admin/dashboard` returns `totalUsers`, `activeUsers`, `pendingDeposits`, `pendingWithdrawals`, `pendingSubmissions`, `approvedDepositPaise`, `paidWithdrawalPaise`, `totalWalletPaise`. Dashboard monetary totals are integer paise, not rupees. Active users are active and not blocked; they can include users awaiting email verification.

Deletes, logout, verification, password changes, and mark-all-read return `data.message`. Toggle and single-notification-read endpoints return the updated entity. Block/activate endpoints return the updated user.

## Database model

`migrations/001_initial.sql` is the authoritative schema, including indexes, foreign keys, uniqueness, balance checks and the immutable-ledger trigger.

| Table | Relationships / role |
|---|---|
| users | Identity, password hash, role, account state |
| sessions, verification_codes | Many sessions / one pending verification per user |
| wallets, ledger | One wallet per user; immutable wallet changes with globally unique source keys |
| plans, gift_codes, tasks, contacts | Validated catalogue fields in JSONB; active and soft-delete flags |
| files | Private proof bytes, owner, MIME type |
| deposits | User + plan + proof; manual review lifecycle |
| withdrawals | User + encrypted bank details; manual payout lifecycle |
| submissions | Unique user/task pair + proof + reward snapshot |
| gift_redemptions | Unique user/gift pair + reward snapshot |
| notifications | User-owned read/unread inbox |
| settings | Singleton public/admin configuration |
| audit_logs | Actor, action, entity and request correlation |
| idempotency | User + route + key, request fingerprint, saved response |
| email_outbox | Encrypted retryable verification mail |
| rate_limits | Shared throttling across API instances |
| schema_migrations | Migration checksums, created by migration runner |
