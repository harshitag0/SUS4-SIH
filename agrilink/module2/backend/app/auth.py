"""Who is calling.

Module 2 does not own identity: the AgriLink platform (Module 1) will. Until
then the caller states a role and actor id in headers:

    X-M2-Role:  admin | fpo | doctor | farmer | buyer | system
    X-M2-Actor: id of the person/organisation (e.g. FRM-RTN-01, DOC-RTN, FPO-RTN, BUY-A)

`admin` = AgriLink operations and may perform any action. `system` is for
service-to-service calls (Module 1 handing over an agreement).
Replace `current_actor` with the platform's token verification on integration.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, Header

from .errors import Forbidden

ROLES = {"admin", "fpo", "doctor", "farmer", "buyer", "system"}


@dataclass(frozen=True)
class Actor:
    role: str
    id: Optional[str]

    def is_(self, *roles: str) -> bool:
        return self.role in roles


def current_actor(x_m2_role: Optional[str] = Header(default=None),
                  x_m2_actor: Optional[str] = Header(default=None)) -> Actor:
    if not x_m2_role or x_m2_role not in ROLES:
        raise Forbidden("missing or unknown X-M2-Role header")
    if x_m2_role not in ("admin", "system") and not x_m2_actor:
        raise Forbidden("X-M2-Actor header is required for this role")
    return Actor(x_m2_role, x_m2_actor)


def require(*roles: str):
    """Allow the listed roles; admin is always allowed."""
    def dep(actor: Actor = Depends(current_actor)) -> Actor:
        if actor.role != "admin" and actor.role not in roles:
            raise Forbidden(f"role '{actor.role}' cannot perform this action")
        return actor
    return dep
