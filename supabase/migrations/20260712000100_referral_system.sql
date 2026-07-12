-- Referral system: 6-digit codes, created lazily (only when a user requests
-- one to share), and per-friend redemption tracking. Reward logic (every 3
-- completed referrals = +40 credits) lives in application code
-- (referral_store.py), not here.
--
-- Superseded by the friend_referral_* tables/service (see
-- 20260712010000_friend_referral_system.sql) -- kept here only so this
-- migration's history matches what's already live on the remote database
-- (it was pushed once via `supabase db push` before the two systems were
-- consolidated). No application code references these tables anymore.

CREATE TABLE IF NOT EXISTS referral_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  completed_referrals_count INTEGER NOT NULL DEFAULT 0,
  reward_batches_granted INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS referral_redemptions (
  redemption_id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  referrer_user_id TEXT NOT NULL,
  referred_user_id TEXT NOT NULL UNIQUE,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_redemptions_referrer
  ON referral_redemptions (referrer_user_id);
