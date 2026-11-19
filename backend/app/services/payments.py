"""Payments gated by an explicit confirmation.

Rules enforced here, not in the client:

* Nothing is charged by a quote. A quote only creates a pending order.
* A pending order is paid only by a separate confirm call, and expires quickly.
* Only Stripe *test* keys are accepted. A live key is refused outright.
* Without a Stripe key the payment is simulated and clearly labelled as such.
"""
from __future__ import annotations

import os
import re
import time
from uuid import uuid4

ORDER_TTL_SECONDS = 60

# Demo menu: keyword -> (spoken name, price in cents). Unknown items are never paid for.
CATALOGUE = {
    'cappuccino': ('cappuccino', 475),
    'latte': ('medium latte', 450),
    'espresso': ('espresso', 300),
    'coffee': ('medium coffee', 350),
    'tea': ('tea', 300),
    'water': ('bottle of water', 200),
    'croissant': ('croissant', 375),
    'sandwich': ('sandwich', 850),
}


class PaymentError(Exception):
    pass


def money(cents: int) -> str:
    return f'${cents / 100:.2f}'


def find_item(text: str) -> tuple[str, int] | None:
    words = set(re.findall(r'[a-z]+', text.lower()))
    for keyword, item in CATALOGUE.items():
        if keyword in words:
            return item
    return None


class Orders:
    def __init__(self) -> None:
        self._pending: dict[str, dict] = {}

    def pending(self, session: str, now: float | None = None) -> dict | None:
        order = self._pending.get(session)
        if order and (now or time.time()) > order['expires']:
            del self._pending[session]
            return None
        return order

    def quote(self, session: str, text: str, now: float | None = None) -> dict | None:
        """Create a pending order for a known item. Charges nothing."""
        item = find_item(text)
        if item is None:
            return None
        now = now or time.time()
        order = {'id': uuid4().hex[:12], 'item': f'one {item[0]}', 'amount': item[1], 'price': money(item[1]),
                 'currency': 'usd', 'expires': now + ORDER_TTL_SECONDS}
        self._pending[session] = order
        return order

    def quote_item(self, session: str, item: str, cents: int, now: float | None = None) -> dict:
        """Create a pending order for an item and price read from the camera. Charges nothing."""
        limit = int(os.getenv('PAY_MAX_CENTS', '5000'))
        if cents > limit:
            raise PaymentError(f'{item.capitalize()} costs {money(cents)}, which is over your {money(limit)} limit. I will not pay for it.')
        now = now or time.time()
        order = {'id': uuid4().hex[:12], 'item': item, 'amount': cents, 'price': money(cents),
                 'currency': 'usd', 'expires': now + ORDER_TTL_SECONDS}
        self._pending[session] = order
        return order

    def cancel(self, session: str) -> dict | None:
        return self._pending.pop(session, None)

    async def confirm(self, session: str, now: float | None = None) -> dict:
        """Pay the pending order. Only ever called after an explicit yes."""
        order = self.pending(session, now)
        if order is None:
            raise PaymentError('There is nothing waiting to be paid.')
        del self._pending[session]  # one confirmation, one charge
        receipt = await charge(order)
        return {**order, **receipt}


def is_test_key(key: str) -> bool:
    """Standard (sk_test_) and restricted (rk_test_) test keys. Live keys never pass."""
    return key.startswith(('sk_test_', 'rk_test_'))


async def charge(order: dict) -> dict:
    key = os.getenv('STRIPE_SECRET_KEY', '').strip()
    if not key:
        return {'mode': 'simulated', 'status': 'simulated', 'payment_id': None}
    if not is_test_key(key):
        raise PaymentError('Only Stripe test keys are accepted. No payment was made.')
    import httpx
    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
        response = await client.post(
            'https://api.stripe.com/v1/payment_intents',
            auth=(key, ''),
            headers={'Idempotency-Key': f'guideband-{order["id"]}'},
            data={
                'amount': order['amount'],
                'currency': order['currency'],
                'payment_method': 'pm_card_visa',  # Stripe's built-in test card
                'confirm': 'true',
                'automatic_payment_methods[enabled]': 'true',
                'automatic_payment_methods[allow_redirects]': 'never',
                'description': f'GuideBand demo: {order["item"]}',
            },
        )
    if response.status_code >= 400:
        raise PaymentError('Stripe declined the test payment. No money moved.')
    body = response.json()
    return {'mode': 'stripe_test', 'status': body.get('status', 'unknown'), 'payment_id': body.get('id')}
