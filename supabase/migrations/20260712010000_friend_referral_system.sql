-- Invite-3-friends referral program (friend_referral_service.py). These
-- tables were referenced by application code but never migrated -- every
-- call was hitting an AttributeError since the Supabase adapter had no
-- collection wired up for them at all.

CREATE TABLE IF NOT EXISTS friend_referral_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS friend_referral_redemptions (
  redemption_id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  referrer_user_id TEXT NOT NULL,
  redeemer_user_id TEXT NOT NULL UNIQUE,
  redeemer_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_friend_referral_redemptions_referrer
  ON friend_referral_redemptions (referrer_user_id);
