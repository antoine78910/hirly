import asyncio

import pytest

from friend_referral_service import (
    FRIEND_REFERRAL_GOAL,
    FRIEND_REFERRAL_REWARD_CREDITS,
    claim_friend_referral_reward,
    enroll_friend_referral,
    friend_referral_status_payload,
    has_redeemed_friend_referral_code,
    redeem_friend_referral_code,
    validate_friend_referral_code,
)


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    async def to_list(self, limit):
        return list(self._rows[:limit])


class _Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def find_one(self, filter, projection=None):
        for row in self.rows:
            if all(row.get(key) == value for key, value in filter.items()):
                return dict(row)
        return None

    def find(self, filter=None, projection=None):
        return _Cursor(list(self.rows))

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
    code = "123456"
    return _DB(
        users=[
            {"user_id": referrer_id, "email": "referrer@example.com", "name": "Referrer", "friend_referral": {"code": code}},
            {"user_id": redeemer_id, "email": "redeemer@example.com", "name": "Redeemer"},
        ],
        codes=[{"code": code, "user_id": referrer_id}],
    )


def test_enroll_is_idempotent(db):
    referrer_id = "user_referrer"
    first = asyncio.run(enroll_friend_referral(db, referrer_id))
    second = asyncio.run(enroll_friend_referral(db, referrer_id))
    assert first["code"] == second["code"]
    user = asyncio.run(db.users.find_one({"user_id": referrer_id}, {"_id": 0}))
    status = friend_referral_status_payload(user)
    assert status["enrolled"] is True
    assert status["uses_count"] == 0


def test_enroll_generates_six_digit_numeric_code():
    db = _DB(users=[{"user_id": "solo_user", "email": "solo@example.com"}])
    status = asyncio.run(enroll_friend_referral(db, "solo_user"))
    assert status["code"] is not None
    assert len(status["code"]) == 6
    assert status["code"].isdigit()


def test_redeem_increments_uses_and_sends_emails(db, monkeypatch):
    referrer_id = "user_referrer"
    redeemer_id = "user_redeemer"
    code = "123456"
    asyncio.run(enroll_friend_referral(db, referrer_id))

    emails = {"use": [], "reward": []}
    granted = []

    async def send_use_email(**kwargs):
        emails["use"].append(kwargs)
        return True

    async def send_reward_email(**kwargs):
        emails["reward"].append(kwargs)
        return True

    async def grant_reward(user_id, credits):
        granted.append((user_id, credits))

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
    code = "123456"
    asyncio.run(enroll_friend_referral(db, referrer_id))

    emails = {"use": [], "reward": []}
    granted = []

    async def send_use_email(**kwargs):
        emails["use"].append(kwargs)
        return True

    async def send_reward_email(**kwargs):
        emails["reward"].append(kwargs)
        return True

    async def grant_reward(user_id, credits):
        granted.append((user_id, credits))

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

    assert granted == [(referrer_id, FRIEND_REFERRAL_REWARD_CREDITS)]
    assert len(emails["use"]) == FRIEND_REFERRAL_GOAL
    assert len(emails["reward"]) == 1
    assert "friendReferral=unlocked" in emails["reward"][0]["claim_url"]

    referrer = asyncio.run(db.users.find_one({"user_id": referrer_id}, {"_id": 0}))
    status = friend_referral_status_payload(referrer, is_premium=False)
    assert status["reward_batches_granted"] == 1
    assert status["credits_earned_total"] == FRIEND_REFERRAL_REWARD_CREDITS
    assert status["uses_count"] == FRIEND_REFERRAL_GOAL
    # Already earned a batch and is premium (once billing grants it) -> banner stops nagging.
    assert friend_referral_status_payload(referrer, is_premium=True)["pending_access"] is False


def test_reward_repeats_every_goal_multiple(db, monkeypatch):
    """Not just a one-time unlock -- every additional 3 referrals grants another batch."""
    referrer_id = "user_referrer"
    code = "123456"
    asyncio.run(enroll_friend_referral(db, referrer_id))

    granted = []

    async def noop_email(**kwargs):
        return True

    async def grant_reward(user_id, credits):
        granted.append((user_id, credits))

    for idx in range(FRIEND_REFERRAL_GOAL * 2):
        redeemer_id = f"user_redeemer_{idx}"
        db.users.rows.append({"user_id": redeemer_id, "email": f"r{idx}@example.com"})
        asyncio.run(
            redeem_friend_referral_code(
                db,
                code=code,
                redeemer_user_id=redeemer_id,
                redeemer_email=f"r{idx}@example.com",
                send_use_email=noop_email,
                send_reward_email=noop_email,
                grant_reward=grant_reward,
                app_url="https://app.example.com",
            )
        )

    assert granted == [
        (referrer_id, FRIEND_REFERRAL_REWARD_CREDITS),
        (referrer_id, FRIEND_REFERRAL_REWARD_CREDITS),
    ]
    referrer = asyncio.run(db.users.find_one({"user_id": referrer_id}, {"_id": 0}))
    status = friend_referral_status_payload(referrer)
    assert status["reward_batches_granted"] == 2
    assert status["credits_earned_total"] == FRIEND_REFERRAL_REWARD_CREDITS * 2


def test_validate_friend_referral_code(db):
    referrer_id = "user_referrer"
    redeemer_id = "user_redeemer"
    code = "123456"
    asyncio.run(enroll_friend_referral(db, referrer_id))

    assert asyncio.run(validate_friend_referral_code(db, code=code, user_id=redeemer_id)) == {
        "valid": True,
        "reason": None,
    }
    assert asyncio.run(validate_friend_referral_code(db, code=code, user_id=referrer_id)) == {
        "valid": False,
        "reason": "self_referral",
    }
    assert asyncio.run(validate_friend_referral_code(db, code="999999", user_id=redeemer_id)) == {
        "valid": False,
        "reason": "not_found",
    }
    assert asyncio.run(validate_friend_referral_code(db, code="ABC123", user_id=redeemer_id)) == {
        "valid": False,
        "reason": "invalid_format",
    }


def test_redeem_rejects_self_referral(db):
    referrer_id = "user_referrer"
    code = "123456"
    asyncio.run(enroll_friend_referral(db, referrer_id))

    async def noop_email(**kwargs):
        return True

    async def grant_reward(user_id, credits):
        pass

    with pytest.raises(ValueError, match="cannot use your own"):
        asyncio.run(
            redeem_friend_referral_code(
                db,
                code=code,
                redeemer_user_id=referrer_id,
                redeemer_email="referrer@example.com",
                send_use_email=noop_email,
                send_reward_email=noop_email,
                grant_reward=grant_reward,
                app_url="https://app.example.com",
            )
        )


def test_redeem_rejects_second_code_for_same_redeemer(db):
    referrer_id = "user_referrer"
    redeemer_id = "user_redeemer"
    code = "123456"
    asyncio.run(enroll_friend_referral(db, referrer_id))

    async def noop_email(**kwargs):
        return True

    async def grant_reward(user_id, credits):
        pass

    asyncio.run(
        redeem_friend_referral_code(
            db,
            code=code,
            redeemer_user_id=redeemer_id,
            redeemer_email="redeemer@example.com",
            send_use_email=noop_email,
            send_reward_email=noop_email,
            grant_reward=grant_reward,
            app_url="https://app.example.com",
        )
    )
    with pytest.raises(ValueError, match="already used"):
        asyncio.run(
            redeem_friend_referral_code(
                db,
                code=code,
                redeemer_user_id=redeemer_id,
                redeemer_email="redeemer@example.com",
                send_use_email=noop_email,
                send_reward_email=noop_email,
                grant_reward=grant_reward,
                app_url="https://app.example.com",
            )
        )


def test_claim_reward_requires_unlock(db):
    referrer_id = "user_referrer"
    asyncio.run(enroll_friend_referral(db, referrer_id))
    with pytest.raises(ValueError, match="No referral reward"):
        asyncio.run(claim_friend_referral_reward(db, referrer_id, token=None))


def test_has_redeemed_friend_referral_code_reflects_redemption(db):
    referrer_id = "user_referrer"
    redeemer_id = "user_redeemer"
    code = "123456"
    asyncio.run(enroll_friend_referral(db, referrer_id))

    assert asyncio.run(has_redeemed_friend_referral_code(db, redeemer_id)) is False

    async def noop_email(**kwargs):
        return True

    async def grant_reward(user_id, credits):
        pass

    asyncio.run(
        redeem_friend_referral_code(
            db,
            code=code,
            redeemer_user_id=redeemer_id,
            redeemer_email="redeemer@example.com",
            send_use_email=noop_email,
            send_reward_email=noop_email,
            grant_reward=grant_reward,
            app_url="https://app.example.com",
        )
    )

    assert asyncio.run(has_redeemed_friend_referral_code(db, redeemer_id)) is True
    # A user who never redeemed anything (e.g. the referrer themselves)
    # should not be flagged as discount-eligible.
    assert asyncio.run(has_redeemed_friend_referral_code(db, referrer_id)) is False
