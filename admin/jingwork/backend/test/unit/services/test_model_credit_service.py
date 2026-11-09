"""实际用量的缓存计费与不可信输入边界。"""

from decimal import Decimal

import pytest
from fastapi import HTTPException

from yuxi.services.model_credit_service import usage_credits


PRICE = {"input": "10", "output": "20", "cache_read": "1", "cache_write": "5"}


def test_cached_tokens_are_not_charged_twice():
    """缓存读写包含在输入总数内，以独立费率结算。"""
    usage = {
        "input_tokens": 1000,
        "output_tokens": 100,
        "input_token_details": {"cache_read": 600, "cache_creation": 100},
    }
    assert usage_credits(usage, PRICE) == Decimal("0.610000")


@pytest.mark.parametrize(
    "usage",
    [
        {"input_tokens": -1, "output_tokens": 10},
        {"input_tokens": True, "output_tokens": 10},
        {"input_tokens": 100},
        {"input_tokens": 100, "output_tokens": 10, "input_token_details": {"cache_read": 101}},
        {"input_tokens": 100, "output_tokens": 10, "input_token_details": {"cache_creation": -1}},
    ],
)
def test_invalid_usage_cannot_change_credit_balances(usage):
    """未知、负数和不一致用量不能形成有效扣费事实。"""
    with pytest.raises(HTTPException) as error:
        usage_credits(usage, PRICE)
    assert error.value.status_code == 422
