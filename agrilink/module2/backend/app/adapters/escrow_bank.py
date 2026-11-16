"""Escrow bank adapter.

The pilot plans a bank escrow (CIMB Singapore under research; terms not
confirmed). SimulatedEscrowBank only issues references for instructions so the
workflow and ledger work end to end. No money moves.
"""
from __future__ import annotations

from ..util import new_id


class SimulatedEscrowBank:
    name = "SIMULATED escrow (CIMB terms not confirmed)"

    def instruct(self, kind: str, agreement_id: str, amount: float) -> str:
        return new_id(f"SIM-{kind.upper()}")


escrow_bank = SimulatedEscrowBank()
