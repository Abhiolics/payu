CREATE TABLE users (
 id text PRIMARY KEY CHECK(id ~ '^[0-9a-f]{24}$'), full_name text NOT NULL,
 email text NOT NULL UNIQUE CHECK(email=lower(email)), phone_number text NOT NULL UNIQUE,
 password_hash text NOT NULL, role text NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
 is_verified boolean NOT NULL DEFAULT false, is_blocked boolean NOT NULL DEFAULT false,
 is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE verification_codes (user_id text PRIMARY KEY REFERENCES users(id), otp_hash text NOT NULL, link_hash text NOT NULL UNIQUE, attempts integer NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL);
CREATE TABLE wallets (user_id text PRIMARY KEY REFERENCES users(id), balance_paise bigint NOT NULL DEFAULT 0 CHECK(balance_paise BETWEEN 0 AND 9000000000000));
CREATE TABLE ledger (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), delta_paise bigint NOT NULL CHECK(delta_paise<>0),
 balance_after_paise bigint NOT NULL CHECK(balance_after_paise>=0), source_key text NOT NULL UNIQUE,
 description text NOT NULL, actor_id text REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_user_date ON ledger(user_id,created_at DESC,id);
CREATE FUNCTION prevent_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Ledger entries are immutable'; END $$;
CREATE TRIGGER immutable_ledger BEFORE UPDATE OR DELETE ON ledger FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE TABLE plans (id text PRIMARY KEY, data jsonb NOT NULL, is_active boolean NOT NULL DEFAULT true, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE gift_codes (id text PRIMARY KEY, data jsonb NOT NULL, code text NOT NULL UNIQUE, used_count integer NOT NULL DEFAULT 0 CHECK(used_count>=0), is_active boolean NOT NULL DEFAULT true, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE tasks (id text PRIMARY KEY, data jsonb NOT NULL, is_active boolean NOT NULL DEFAULT true, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE contacts (id text PRIMARY KEY, data jsonb NOT NULL, is_active boolean NOT NULL DEFAULT true, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE files (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), mime_type text NOT NULL, content bytea NOT NULL CHECK(octet_length(content)<=5242880), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE deposits (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), plan_id text NOT NULL REFERENCES plans(id),
 amount_paise bigint NOT NULL CHECK(amount_paise>0), transaction_ref text NOT NULL UNIQUE, proof_id text NOT NULL REFERENCES files(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), reason text,
 reviewed_by text REFERENCES users(id), reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE withdrawals (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), amount_paise bigint NOT NULL CHECK(amount_paise>0), bank_encrypted text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), reason text, payout_ref text UNIQUE,
 reviewed_by text REFERENCES users(id), reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE submissions (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), task_id text NOT NULL REFERENCES tasks(id), proof_id text NOT NULL REFERENCES files(id),
 reward_paise bigint NOT NULL CHECK(reward_paise>0), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reason text, reviewed_by text REFERENCES users(id), reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,task_id)
);
CREATE TABLE gift_redemptions (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), gift_id text NOT NULL REFERENCES gift_codes(id), reward_paise bigint NOT NULL CHECK(reward_paise>0), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,gift_id));
CREATE TABLE notifications (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), title text NOT NULL, message text NOT NULL, is_read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX notifications_user ON notifications(user_id,is_read,created_at DESC);
CREATE TABLE settings (id integer PRIMARY KEY CHECK(id=1), data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO settings VALUES (1,'{"maintenanceMode":false,"maintenanceMessage":"","forceUpdate":false,"updateMessage":"","currentVersion":"1.0.0","qrCode":{"enabled":false,"imageUrl":""},"bankAccount":{"enabled":false,"accountHolder":"","bankName":"","accountNumber":"","ifscCode":"","upiId":""}}',now());
CREATE TABLE audit_logs (id text PRIMARY KEY, actor_id text REFERENCES users(id), action text NOT NULL, entity_id text, request_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE idempotency (user_id text NOT NULL REFERENCES users(id), scope text NOT NULL, key text NOT NULL, fingerprint text NOT NULL, response text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,scope,key));
CREATE TABLE rate_limits (key text PRIMARY KEY, hits integer NOT NULL, reset_at timestamptz NOT NULL);
CREATE TABLE email_outbox (id text PRIMARY KEY, payload_encrypted text NOT NULL, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX deposits_user_date ON deposits(user_id,created_at DESC);
CREATE INDEX withdrawals_user_date ON withdrawals(user_id,created_at DESC);
CREATE INDEX submissions_user_date ON submissions(user_id,created_at DESC);
CREATE INDEX outbox_due ON email_outbox(next_attempt_at);
