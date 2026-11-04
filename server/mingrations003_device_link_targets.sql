ALTER TABLE device_link_codes
ADD COLUMN IF NOT EXISTS target_device_name VARCHAR(100);

ALTER TABLE device_link_codes
ADD COLUMN IF NOT EXISTS target_device_token_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_device_link_target_token
ON device_link_codes(target_device_token_hash)
WHERE target_device_token_hash IS NOT NULL;
