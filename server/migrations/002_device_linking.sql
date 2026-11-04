BEGIN;

CREATE TABLE IF NOT EXISTS device_link_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    source_device_id UUID NOT NULL
        REFERENCES devices(id) ON DELETE CASCADE,

    code_hash VARCHAR(255) NOT NULL UNIQUE,

    expires_at TIMESTAMPTZ NOT NULL,

    consumed_at TIMESTAMPTZ,

    attempts INTEGER NOT NULL DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_link_user
ON device_link_codes(user_id);

CREATE INDEX IF NOT EXISTS idx_device_link_expiry
ON device_link_codes(expires_at);

COMMIT;
