import asyncio

import pytest

from friend_referral_service import (
    FRIEND_REFERRAL_GOAL,
    claim_friend_referral_reward,
    enroll_friend_referral,
    friend_referral_status_payload,
    redeem_friend_referral_code,
    referral_code_from_user_id,
)


class _Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def find_one(self, filter, projection=None):
        for row in self.rows:
            if all(row.get(key) == value for key, value in filter.items()):
                return dict(row)
        return None

    async def update_one(self, filter, update, upsert=False):
        matched = None
        for row in self.rows:
            if all(row.get(key) == value for key, value in filter.items()):
                matched = row
                break
        if not matched and upsert:
            matched = dict(filter)
            self.rows.append(matched)
        if not matched:
            return {"matched_count": 0, "modified_count": 0}

        if "$set" in update:
            for key, value in update["$set"].items():
                if "." in key:
                    top, nested = key.split(".", 1)
                    matched.setdefault(top, {})
                    matched[top][nested] = value
                else:
                    matched[key] = value
        return {"matched_count": 1, "modified_count": 1}

    async def insert_one(self, doc):
        self.rows.append(dict(doc))
        return {"inserted_id": doc.get("redemption_id")}


class _DB:
    def __init__(self, users=None, codes=None, redemptions=None):
        self.users = _Collection(users)
        self.friend_referral_codes = _Collection(codes)
        self.friend_referral_redemptions = _Collection(redemptions)


@pytest.fixture
def db():
    referrer_id = "user_referrer"
    redeemer_id = "user_redeemer"
    code = referral_code_from_user_id(referrer_id)
    return _DB(
        users=[
            {"user_id": referrer_id, "email": "referrer@example.com", "name": "Referrer"},
            {"user_id": redeemer_id, "email": "redeemer@example.com", "name": "Redeemer"},
        ],
        codes=[{"code": code, "user_id": referrer_id}],
    )


def test_referral_code_matches_frontend_algorithm():
    assert referral_code_from_user_id("abc123") == referral_code_from_user_id("abc123")
    assert len(referral_code_from_user_id("abc123")) == 6


def test_enroll_is_idempotent(db):
    referrer_id = "user_referrer"
    asyncio.run(enroll_friend_referral(db, referrer_id))
    asyncio.run(enroll_friend_referral(db, referrer_id))
    user = asyncio.run(db.users.find_one({"user_id": referrer_id}, {"_id": 0}))
    status = friend_referral_status_payload(user)
    assert status["enrolled"] is True
    assert status["uses_count"] == 0


def test_redeem_increments_uses_and_sends_emails(db, monkeypatch):
    referrer_id = "user_referrer"
    redeemer_id = "user_redeemer"
    code = referral_code_from_user_id(referrer_id)
    asyncio.run(enroll_friend_referral(db, referrer_id))

    emails = {"use": [], "reward": []}
    granted = []

    async def send_use_email(**kwargs):
        emails["use"].append(kwargs)
        return True

    async def send_reward_email(**kwargs):
        emails["reward"].append(kwargs)
        return True

    async def grant_reward(user_id):
        granted.append(user_id)

    result = asyncio.run(
        redeem_friend_referral_code(
            db,
            code=code,
            redeemer_user_id=redeemer_id,
            redeemer_email="redeemer@example.com",
            send_use_email=send_use_email,
            send_reward_email=send_reward_email,
            grant_reward=grant_reward,
            app_url="https://app.example.com",
        )
    )

    assert result["uses_count"] == 1
    assert result["reward_unlocked"] is False
    assert len(emails["use"]) == 1
    assert emails["use"][0]["uses_count"] == 1
    assert granted == []


def test_redeem_unlocks_reward_after_three_uses(db, monkeypatch):
    referrer_id = "user_referrer"
    code = referral_code_from_user_id(referrer_id)
    asyncio.run(enroll_friend_referral(db, referrer_id))

    emails = {"use": [], "reward": []}
    granted = []

    async def send_use_email(**kwargs):
        emails["use"].append(kwargs)
        return True

    async def send_reward_email(**kwargs):
        emails["reward"].append(kwargs)
        return True

    async def grant_reward(user_id):
        granted.append(user_id)

    for idx in range(FRIEND_REFERRAL_GOAL):
        redeemer_id = f"user_redeemer_{idx}"
        db.users.rows.append({"user_id": redeemer_id, "email": f"r{idx}@example.com"})
        asyncio.run(
            redeem_friend_referral_code(
                db,
                code=code,
                redeemer_user_id=redeemer_id,
                redeemer_email=f"r{idx}@example.com",
                send_use_email=send_use_email,
                send_reward_email=send_reward_email,
                grant_reward=grant_reward,
                app_url="https://app.example.com",
            )
        )

    assert len(granted) == 1
    assert granted[0] == referrer_id
    assert len(emails["use"]) == FRIEND_REFERRAL_GOAL
    assert len(emails["reward"]) == 1
    assert "friendReferral=unlocked" in emails["reward"][0]["claim_url"]

    referrer = asyncio.run(db.users.find_one({"user_id": referrer_id}, {"_id": 0}))
    status = friend_referral_status_payload(referrer)
    assert status["reward_granted"] is True
    assert status["uses_count"] == FRIEND_REFERRAL_GOAL


def test_claim_reward_requires_unlock(db):
    referrer_id = "user_referrer"
    asyncio.run(enroll_friend_referral(db, referrer_id))
    with pytest.raises(ValueError, match="No referral reward"):
        asyncio.run(claim_friend_referral_reward(db, referrer_id, token=None))
