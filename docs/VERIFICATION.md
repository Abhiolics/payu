# Verification record

Verified in the provided workspace on 2026-09-11.

| Check | Result |
|---|---|
| JavaScript syntax | Passed (`npm run check`) |
| API integration suite | 20 passed, 0 failed, 2 skipped |
| Schema application | Passed using PGlite's PostgreSQL engine |
| Collection coverage | All 71 documented requests match implemented Express routes; 62 originate in the uploaded collection |
| Accounting behavior | Deposit credit once; withdrawal reservation, insufficient-funds rejection, rejection refund once, payout reference requirement, reward snapshot and one-time gift redemption passed |
| Access control | User/admin separation, revoked sessions, profile privilege injection, private proof and notification ownership passed |
| Encryption | Bank details and saved idempotency responses remain encrypted in database storage; verification email outbox encrypted |
| Ledger consistency | Wallet balances reconcile to immutable ledger changes; edit attempts rejected |
| Production dependency audit | 0 reported vulnerabilities at time of check; report included in dependency-audit.json |
| Separate PostgreSQL concurrency tests | Not run locally: runtime cannot switch to an unprivileged system user to launch PostgreSQL; included in CI with PostgreSQL 18 |
| Docker build and Compose runtime | Not run locally: Docker is not available in this workspace |
| SMTP delivery to a real mailbox | Not exercised; encrypted enqueue and verification consumption tested |
| Hosted deployment / frontend integration | Not performed: hosting credentials and frontend source were not supplied |

`test-results.txt` contains the final API test output. For an independent run, use `npm ci`, `npm run check`, then `npm test`. The two skipped tests require `TEST_DATABASE_URL` and test simultaneous withdrawals and simultaneous approval requests using separate database connections. The GitHub Actions workflow provides that PostgreSQL service and runs the full suite automatically when used in a repository.

Tests check service behavior through HTTP and real SQL execution. They do not certify banking/payment-provider behavior: all settlement in this contract is manually reviewed and external to the API. The full initial schema is provided so deploy-time migrations are reproducible.
