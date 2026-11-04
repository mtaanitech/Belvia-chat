BEGIN;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS auth_method VARCHAR(30)
DEFAULT 'phone_password';

ALTER TABLE users
ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

ALTER TABLE users
ADD CONSTRAINT users_auth_method_check
CHECK (
    auth_method IN ('phone_password', 'device_verification')
) NOT VALID;

ALTER TABLE users
ADD CONSTRAINT users_auth_credentials_check
CHECK (
    (
        auth_method = 'phone_password'
        AND password_hash IS NOT NULL
    )
    OR
    (
        auth_method = 'device_verification'
        AND password_hash IS NULL
    )
) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_users_phone
ON users(phone_number);

COMMIT;
