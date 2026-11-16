"""Escrow tranche 2 state machine (pilot flow). Pure: takes and returns a state dict.

States: SIGNED (tranche 1 funded and released at signing, done by Module 1)
     -> FUNDED (buyer funds tranche 2 at dispatch)
     -> RECEIVED (goods in Singapore; dispute window opens)
     -> DISPUTED (inside window)          -> RELEASED | REFUNDED (surveyor)
     -> RELEASED (buyer satisfied, or window passed with no dispute)
"""
from __future__ import annotations

from datetime import datetime, timedelta

from ..errors import Conflict, DomainError


def initial(contract_value: float, tranche1_released: bool, at: datetime) -> dict:
    half = round(contract_value / 2, 2)
    st = {"status": "SIGNED", "contract_value": contract_value,
          "tranche1": half, "tranche2": round(contract_value - half, 2),
          "paid_to_fpo": 0.0, "held": 0.0, "refunded_to_buyer": 0.0,
          "received_at": None, "window_ends_at": None, "ledger": []}
    if tranche1_released:
        st["paid_to_fpo"] = half
        st["ledger"].append({"at": at, "step": "Tranche 1 funded and released to FPO at signing",
                             "amount": half, "ref": "MODULE1"})
    return st


def _need(st: dict, *statuses: str, action: str) -> None:
    if st["status"] not in statuses:
        raise Conflict(f"cannot {action} while escrow is {st['status']}")


def settlement(contract_value: float, order_kg: float, shipped_kg: float, advance_paid: float) -> dict:
    """What the buyer owes for what is actually shipped (pro rata, capped at the contract value).

    tranche2_due = payable value - advance already paid at signing.
    If the advance exceeds the payable value, the excess is owed back by the FPO
    (recorded, settled outside this escrow: the bank holds no FPO money).
    """
    share = min(max(shipped_kg, 0) / order_kg, 1.0) if order_kg else 0.0
    payable = round(contract_value * share, 2)
    return {"shipped_kg": shipped_kg, "order_kg": order_kg, "share": round(share, 4), "payable_value": payable,
            "advance_paid": advance_paid, "tranche2_due": round(max(payable - advance_paid, 0.0), 2),
            "advance_excess": round(max(advance_paid - payable, 0.0), 2)}


def fund_tranche2(st: dict, at: datetime, ref: str, amount: float) -> dict:
    _need(st, "SIGNED", action="fund tranche 2")
    if amount < 0:
        raise DomainError("amount cannot be negative")
    st["tranche2"] = amount
    st["held"] = amount
    st["status"] = "FUNDED"
    st["ledger"].append({"at": at, "step": "Buyer funded tranche 2 for the shipped quantity (held in escrow)"
                         if amount else "Nothing further due: the advance covers the shipped quantity",
                         "amount": amount, "ref": ref})
    return st


def receive(st: dict, at: datetime, window_hours: float) -> dict:
    _need(st, "FUNDED", action="record receipt")
    st["received_at"] = at
    st["window_ends_at"] = at + timedelta(hours=window_hours)
    st["status"] = "RECEIVED"
    st["ledger"].append({"at": at, "step": f"Goods received in Singapore; {window_hours:g} h dispute window opens",
                         "amount": 0.0, "ref": None})
    return st


def _release(st: dict, at: datetime, note: str, ref: str) -> dict:
    amt = st["held"]
    st["paid_to_fpo"] = round(st["paid_to_fpo"] + amt, 2)
    st["held"] = 0.0
    st["status"] = "RELEASED"
    st["ledger"].append({"at": at, "step": f"Tranche 2 released to FPO: {note}", "amount": amt, "ref": ref})
    return st


def confirm(st: dict, at: datetime, ref: str) -> dict:
    _need(st, "RECEIVED", action="confirm")
    return _release(st, at, "buyer confirmed origin quality", ref)


def dispute(st: dict, at: datetime, reason: str) -> dict:
    _need(st, "RECEIVED", action="dispute")
    if at > st["window_ends_at"]:
        raise Conflict("the dispute window has closed")
    if not reason or not reason.strip():
        raise DomainError("a dispute needs a reason")
    st["status"] = "DISPUTED"
    st["ledger"].append({"at": at, "step": "Buyer disputed origin quality; funds stay held, surveyor called",
                         "amount": 0.0, "ref": None})
    return st


def surveyor(st: dict, at: datetime, cause: str, ref: str) -> dict:
    _need(st, "DISPUTED", action="record the surveyor decision")
    if cause == "transit":
        return _release(st, at, "surveyor found transit damage (buyer's risk)", ref)
    if cause == "origin_quality":
        amt = st["held"]
        st["refunded_to_buyer"] = round(st["refunded_to_buyer"] + amt, 2)
        st["held"] = 0.0
        st["status"] = "REFUNDED"
        st["ledger"].append({"at": at, "step": "Tranche 2 refunded to buyer: surveyor found an origin quality fault",
                             "amount": amt, "ref": ref})
        return st
    raise DomainError("cause must be 'transit' or 'origin_quality'")


def auto_release_due(st: dict, at: datetime) -> bool:
    return st["status"] == "RECEIVED" and st["window_ends_at"] is not None and at > st["window_ends_at"]


def auto_release(st: dict, at: datetime, ref: str) -> dict:
    if not auto_release_due(st, at):
        raise Conflict("dispute window is still open or receipt not recorded")
    return _release(st, at, "no dispute within the window (automatic)", ref)
