ALTER TABLE app_users ADD COLUMN session_version integer NOT NULL DEFAULT 0 CHECK (session_version >= 0);
--> statement-breakpoint
CREATE TABLE auth_credentials (
 user_id text PRIMARY KEY REFERENCES app_users(id),
 email text NOT NULL UNIQUE CHECK (email = lower(trim(email)) AND length(email) BETWEEN 3 AND 254),
 password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
 verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE auth_challenges (
 user_id text NOT NULL REFERENCES auth_credentials(user_id),
 purpose text NOT NULL CHECK (purpose IN ('verify','reset')),
 identity uuid NOT NULL UNIQUE,
 code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz NOT NULL,
 issued_at timestamptz NOT NULL DEFAULT now(),
 consumed_at timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
 PRIMARY KEY (user_id,purpose)
);
--> statement-breakpoint
CREATE TABLE auth_rate_limits (
 key text PRIMARY KEY,
 window_start timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0)
);
