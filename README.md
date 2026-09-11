# Pay backend

A runnable Node.js 24 / Express 5 / PostgreSQL backend derived from the supplied `pay.postman_collection.json`. Includes user and admin APIs, schema migration, email verification worker, protected proof uploads, wallet ledger, Docker Compose, integration tests, OpenAPI, a sanitized Postman collection, and a TypeScript frontend helper.

**Read the business assumptions before using real money.** The original collection contains requests but no saved responses or provider integrations. This is a new implementation of those request contracts, not a recovered copy of the original backend. Existing MongoDB-style IDs are retained as 24-character hexadecimal IDs, but old records and tokens are not imported.

## Start with Docker

Requires Docker Engine with Compose v2. From the extracted `pay-backend` directory:

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Put that random value into `APP_SECRET`. Generate another value for `POSTGRES_PASSWORD`. Leave the development URLs and Mailpit settings in place.

```bash
docker compose --profile dev up --build -d
docker compose logs migrate
```

The migration service must finish successfully before API and worker start. API: `http://localhost:5003/api`. Readiness: `http://localhost:5003/health/ready`. Development email inbox: `http://localhost:8025`.

Create an administrator with an email and phone you control. The password must be at least 14 characters. These values come from your shell; they are not built into the image:

```bash
export ADMIN_EMAIL='admin@your-domain.example'
export ADMIN_PHONE='9000000000'
read -s -p 'Admin password: ' ADMIN_PASSWORD
export ADMIN_PASSWORD
docker compose run --rm -e ADMIN_EMAIL -e ADMIN_PHONE -e ADMIN_PASSWORD api npm run admin
unset ADMIN_PASSWORD
```

This creates a verified administrator. It will refuse to overwrite an existing account. Administrators log in using `/auth/login`, just like users. Public registration cannot create or promote an admin.

## Run directly

With Node.js 24 and a running PostgreSQL server:

```bash
npm ci
cp .env.example .env
# Set DATABASE_URL, APP_SECRET, URLs, and reachable SMTP settings in .env.
npm run migrate
npm start
# Separate terminal/process:
npm run worker
```

Direct Node development can use Mailpit on localhost if its SMTP port is separately exposed. Compose only exposes its web inbox by default. Use your own reachable SMTP server otherwise.

## Frontend integration

1. Import `docs/pay.postman_collection.json`. `paylocal` is `http://localhost:5003/api/`, including its trailing slash.
2. Set the collection's `email` and `password` variables to your account credentials. Run **login**; its test script saves `token` automatically.
3. API JSON responses use `{ "success": true, "data": ... }`. List endpoints put arrays in `data.items`; pagination is in `data.pagination`.
4. Send `Authorization: Bearer <token>` on authenticated requests. Sessions last 24 hours. Login again after expiry; there is no refresh token endpoint.
5. Financial submissions and reviews require `Idempotency-Key`. Use a fresh UUID for a new action; reuse the same key and body only when retrying that action.
6. Create deposits with multipart fields `planId`, `transactionRef`, `amount`, and `paymentProof`; submit tasks with file field `proof`. Let the browser set the multipart boundary.
7. Download proof files with Authorization. Do not use the proof URL directly in an unauthenticated `<img>`.

See [frontend-client.ts](docs/frontend-client.ts), [API contract](docs/API.md), [OpenAPI](docs/openapi.json), and [endpoint mapping](docs/ENDPOINTS.md). The supplied frontend was not available, so its existing response adapters have not been changed or tested.

## Implemented behavior and assumptions

- Currency is INR. Input amounts are rupees with at most two decimals. Accounting uses integer paise and a nonnegative wallet constraint. Responses include rupee display amounts and original paise fields; PostgreSQL bigint fields are strings. Use decimal-safe formatting for display and avoid computing balances in the frontend.
- **Deposits are manual wallet top-ups.** Approval credits the submitted amount once. `planId` records the selected active plan; the submitted amount is not required to equal its catalogue price. This is an explicit assumption because the source gives a deposit amount and a plan but no entitlement rules. No subscription, recurring profit, interest, or membership benefit is automatically created.
- **Withdrawals reserve funds immediately.** Available wallet balance decreases at creation. Rejection refunds the reservation once. Approval records a transfer already completed outside this application and requires a unique `payoutRef`. The endpoint does not send money to a bank.
- Payment evidence is uploaded by the user. An administrator must verify the payment independently before approving a deposit. There is no bank reconciliation or automatic provider webhook in the source.
- **Tasks pay once per user per task.** A submission snapshots the reward at creation; later task edits do not change pending rewards. A rejected submission cannot be resubmitted under the same task. Create a new task for another attempt if needed.
- **Gift codes** credit wallets once per user, before expiry and within `maxUsers`. Capacity and redemption are protected by the same database transaction. The redemption endpoint was added because it was absent from the source.
- **Email OTP and verification links verify accounts only.** They do not bypass passwords or reset them. User login requires verification. Codes expire in 10 minutes, allow five wrong attempts, and are single-use. `/auth/send-otp` resends only for an unverified eligible account. Authenticated password change revokes all sessions; forgotten-password recovery is not present in the supplied contract.
- Blocking/deactivating users revokes existing sessions. An unblock does not restore old sessions. Admin accounts are protected from these user controls.
- Deletes for plans, tasks, gift codes and contacts are soft deletes. Related financial records remain intact. Already-submitted deposits/tasks may still be reviewed after catalogue deletion.
- Maintenance blocks user mutations except authentication; admin writes and reads remain available. `forceUpdate` is frontend-facing metadata; clients must implement their version check.
- PNG/JPEG/PDF proofs are limited to 5 MiB, checked by file signature, and stored in PostgreSQL with owner/admin access. Signature checking does not replace malware scanning. Files download as attachments. Database storage makes a single deployment self-contained; high-volume use should move this adapter to private object storage.
- Payment-method settings intentionally expose enabled receiving bank/UPI details to the public, matching `/payment-methods`. Withdrawal destination bank details are encrypted and returned only to the owner/admin.

## Deployment

See [DEPLOYMENT.md](docs/DEPLOYMENT.md). Configure production HTTPS URLs, SMTP, the database, backups and a reverse proxy. Set `NODE_ENV=production`; the application refuses insecure frontend/API URLs in that mode. `APP_SECRET` encrypts bank details and queued verification emails and authenticates OTP hashes: preserve it securely with database backups. Do not rotate it without a data re-encryption migration.

No deployment to your hosting account or payment-provider setup has been performed. The project can be deployed once your environment values are supplied.

## Tests

```bash
npm run check
npm test
# Full PostgreSQL run, including parallel requests. Use a dedicated test database:
TEST_DATABASE_URL=postgres://user:password@localhost:5432/pay_test npm test
```

The default suite uses PGlite (a PostgreSQL engine) and skips tests requiring multiple connections. With `TEST_DATABASE_URL`, tests create a temporary isolated schema, run against PostgreSQL, then drop that test schema. The supplied GitHub Actions workflow runs this mode.

`npm run reconcile` compares each wallet with the sum of its immutable ledger entries. It reports discrepancies and exits nonzero without changing data. See [VERIFICATION.md](docs/VERIFICATION.md) for the delivered run results and remaining external checks.

## Source references

Row locking follows [PostgreSQL's explicit locking documentation](https://www.postgresql.org/docs/current/explicit-locking.html). HTTP hardening follows the applicable [Express security guidance](https://expressjs.com/en/advanced/best-practice-security/). Review dependency updates and run this project's tests before upgrades.
