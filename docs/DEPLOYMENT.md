# Deployment and operations

## Components

- API process: `npm start`, port 5003.
- Email worker: `npm run worker`, same database and APP_SECRET as the API.
- Migration release job: `npm run migrate`, before either process starts.
- PostgreSQL 18 with durable storage. The initial migration is transactional, uses a migration lock, and rejects changed checksums for already-applied migrations.

Docker Compose supplies all three processes and PostgreSQL. The `dev` profile adds Mailpit. A production container platform may run the same image as three services/jobs with separate commands.

## Production configuration

Set `NODE_ENV=production`, a random 48+ character APP_SECRET, DATABASE_URL, PUBLIC_API_URL (`https://api.your-domain` without `/api`), CORS_ORIGINS (comma-separated exact HTTPS frontend origins with no trailing slashes), SMTP_HOST/PORT/USER/PASSWORD, and MAIL_FROM using your verified sending domain. For SMTP on port 465 set SMTP_SECURE=true. For port 587 leave false; production then requires STARTTLS. Keep credentials in the host's secret manager.

Use a managed database's certificate-verified TLS connection settings. Do not set `rejectUnauthorized: false`. The `pg` client accepts TLS options through its connection URL. The local Compose connection stays inside its Docker network.

Put a reverse proxy/load balancer with HTTPS in front of port 5003. Compose binds that port to loopback so it is not directly public. Set TRUST_PROXY_HOPS only to the number of trusted proxy hops, and restrict direct backend access to that proxy. Incorrect proxy trust can undermine IP throttling. Configure a 6 MiB proxy request-size limit and a request timeout above the API's normal response time. The API accepts a 5 MiB proof and 64 KiB JSON.

For a host reverse proxy, forward Authorization, Idempotency-Key, X-Forwarded-For and X-Forwarded-Proto. Health checks use `/health/ready`; liveness uses `/health/live`. No API key or bearer token is required for those probes.

Set real SMTP values and run `docker compose up --build -d` without the `dev` profile in production. Do not expose the development email inbox. Configure DNS and HTTPS on your host; these are not provisioned by this project. Docker image tags are explicit major/minor lines; pin approved image digests in your release pipeline if required.

## Database roles and backups

The local Compose user is a development/bootstrap owner. For production, use a migration owner and a separate runtime role with table SELECT/INSERT/UPDATE/DELETE privileges, but revoke UPDATE/DELETE on ledger and prevent schema changes. Retain SELECT/INSERT for ledger and normal privileges for the other application tables. The migration itself also installs an immutable ledger trigger. Do not grant end users direct database access.

Back up PostgreSQL, including files, and preserve APP_SECRET separately. Prove restore works before accepting valuable data. Catalogue deletes are soft; no financial history cleanup is automated. Idempotency records are retained indefinitely to avoid replaying an old monetary command.

Run `npm run reconcile` on your operational schedule and investigate any nonzero result before correcting data. Never manually edit ledger history; create an auditable compensating wallet adjustment through the API.

## Money operations

Deposits and withdrawals are manual workflows. The API does not know that a bank transfer has happened. Operators verify incoming deposits independently and supply a bank payout reference only after sending a withdrawal. A failed outgoing transfer should remain pending until confirmed or rejected, not be marked approved. Provider-driven automatic payouts need a separate integration with provider idempotency, signed webhooks, durable payout states, and reconciliation.

Request idempotency is scoped to user + HTTP method + path + key. The same key with a changed body returns 409. It is safe to retry identical requests after network failure. Do not generate a new key for the same intended action simply because the response was lost. Request fingerprints preserve JSON property order: retry the exact serialized body. Even with different keys, duplicate reviews of the same entity cannot change the wallet twice.

Database locks prevent overspending and serialize reviews/redemptions. Database statement timeouts or connection failures may return 500; retry the same idempotent action with its original key. Business conflicts return 409 and should be shown to the user.

## Email delivery

Registration saves an encrypted email to the outbox within its database transaction. The worker sends it, retrying up to five attempts every 30 seconds. Expired messages/codes are removed after ten minutes. Delivery is at least once: a worker crash after SMTP acceptance can send a duplicate email. Both copies contain the same single-use code. For an unverified account, `/auth/send-otp` creates a new code and invalidates the old one.

Monitor `mail_delivery_failed` and `worker_error` events, readiness, database capacity and reconciliation output. The API logs an opaque request ID and error code without passwords, uploaded contents, tokens, bank data or request bodies. The bundled worker removes expired sessions and rate-limit records. Run at least one worker even when email traffic is quiet.

## Limitations and extension points

No payment gateway SDK, automatic KYC, automated bank transfers, forgotten-password recovery, notification push service, membership entitlement engine, historical MongoDB migration, or frontend code is supplied by the source collection. These must be specified separately if your product requires them. The included notification system is an in-app database inbox. Secrets and SMTP credentials must come from you; none from the uploaded collection is reused.

File signature validation is intentionally small and does not parse or sanitize document contents. Files are private attachments. Integrate malware scanning before allowing additional file types or public sharing. For large storage volumes, replace `src/files.js` and keep the same authenticated download contract.
