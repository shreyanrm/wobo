"""The console's door: who is an admin, how a console session opens, and the trail it leaves.

This module is the security boundary of the operator console. Everything behind ``/v1/admin`` can
see every learner in the product, and the product serves children, so this file is written as if
the attacker already has a learner's token, a stolen laptop and the front-end source.

THE FIVE RULINGS, each one a decision and not a default.

1. AN ADMIN IS A ROW, NEVER A CLAIM.
   :func:`admin_for` reads ``ops.admins`` with the service role. Nothing in a token makes anybody
   an admin: Supabase's ``user_metadata`` is writable by the user it describes, so a ``role``
   claim is an authorisation the attacker fills in himself. Being signed in — even as a real,
   verified, paying learner — is never sufficient for a single byte behind this door.

2. THE FACTOR IS THE PRODUCT'S OWN SIGN-IN, PLUS TOTP.
   No password store is invented here. ``auth.py`` has already verified a Supabase access token by
   signature, audience and issuer before this module is reached; this module adds (a) the register
   check and (b) an assurance-level check, ``aal == "aal2"``, which Supabase writes only after a
   TOTP factor has actually been verified. See :func:`mfa_enforced` for the one switch and where
   it is refused.

3. THE CONSOLE SESSION IS SHORT, SERVER-SIDE AND REVOCABLE.
   A Supabase access token cannot be cancelled before it expires and refreshes itself all day. So
   a second session sits on top: an opaque token, only its SHA-256 stored, thirty minutes by
   default, no refresh, killable by a row update. An admin request needs the Supabase token AND
   this session AND an active register row. Any one missing is a refusal.

4. NO AUDIT, NO ACCESS.
   :func:`guard` writes the trail BEFORE the endpoint runs, and if the trail cannot be written the
   request is refused. An audit that may be silently dropped under load is not an audit. Reads are
   recorded as carefully as writes, because the risk in a console over children's data is somebody
   LOOKING, and looking leaves no other mark.

5. THE GUARD IS CARRIED BY THE ROUTER, NOT BY THE AUTHOR.
   :func:`admin_router` returns an ``APIRouter`` whose ``dependencies`` already contain
   :func:`guard`. A new endpoint added to it is protected because of where it lives, not because
   somebody remembered a decorator. ``tests/test_admin_guard.py`` walks the built app and fails if
   any ``/v1/admin`` route is ever mounted without it.

WHAT IS NOT DONE HERE, said plainly. The step-up check proves a FRESH aal2 token, not a fresh
challenge driven by this server — the gateway never holds the user's factor. The console runs
``supabase.auth.mfa.challengeAndVerify()`` itself and posts the resulting new access token to
``POST /v1/admin/session/reauth``; we verify it is aal2 and that its ``iat`` is inside
``ADMIN_REAUTH_TOKEN_MAX_AGE_S``. That is a real second proof, and it is weaker than a
server-driven challenge would be. It is written down rather than glossed.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Protocol

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response
from fastapi.routing import APIRoute

from wobo_gateway import console_panels
from wobo_gateway.auth import dev_auth_requested

logger = logging.getLogger("wobo.admin")

#: One prefix, and the app's limiter keys off it. Nothing admin lives outside it.
ADMIN_PREFIX = "/v1/admin"

#: The header the console sends its session token in.
SESSION_HEADER = "x-wobo-admin-session"

#: The cookie the same token is ALSO set in. Both are accepted, and here is the honest reasoning
#: for carrying two rather than picking one:
#:
#:   * A COOKIE is better against a script that gets into the page: HttpOnly means the token
#:     cannot be read back out. It is worse across origins — SameSite=Strict means the browser
#:     will not send it at all when the console and the gateway are on different sites, which is
#:     exactly the deployment this product has today (a Vercel front end, a Railway gateway).
#:   * A HEADER is the reverse: it works across origins, and a script in the page can read it.
#:
#: Neither is a CSRF exposure here, and that is not luck. Every admin request must ALSO carry a
#: verified Supabase access token in ``Authorization`` (the app's middleware refuses ``/v1``
#: without one before this module is reached), and a cross-site request cannot set that header.
#: So a browser silently attaching the cookie to somebody else's form post achieves nothing.
SESSION_COOKIE = "wobo_admin_session"

_SCHEMA = "ops"
_HTTP_TIMEOUT_S = 5.0
_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


# --- levels and permissions ----------------------------------------------------------------------
#
# "me and my team" is not one permission. Somebody who is looking at the spend does not need the
# power to change what a learner is charged, and exactly one person needs the power to add the
# next admin. Three levels, and the vocabulary below is what every route names.
VIEWER = "viewer"
OPERATOR = "operator"
OWNER = "owner"
ROLES: tuple[str, ...] = (VIEWER, OPERATOR, OWNER)

#: Look at the console's own aggregates: spend, usage, model mix, alerts, counts.
CONSOLE_READ = "console.read"
#: Look at one named learner's operational record (plan, meter, support case). Always audited.
LEARNER_READ = "learner.read"
#: Change a learner's data, plan or money. Step-up required, always audited.
LEARNER_ACT = "learner.act"
#: Act on a support case: reply, resolve, escalate. Step-up required.
SUPPORT_ACT = "support.act"
#: Change the admin register itself. Step-up required, and only an owner has it.
ADMIN_MANAGE = "admin.manage"

# THE LOWEST SEAT DOES NOT READ A CHILD'S CONTACT DETAILS. ``viewer`` is described to the person
# holding it as "see everything in the console, and change nothing", and it used to carry
# LEARNER_READ — which is ``GET /v1/admin/reports/who``, and which answers with a learner's real
# subject id and the address a parent typed on a refund request. Reading is exactly the risk this
# console is written against: the harm in a console over children's data is somebody LOOKING, and
# looking leaves no other mark. So the aggregates (money, models, queues, counts) are the viewer
# seat, and identifying one named person is the seat that also has to answer for what it did with
# the answer. The desks follow from this table and need no edit of their own.
PERMISSIONS: dict[str, frozenset[str]] = {
    VIEWER: frozenset({CONSOLE_READ}),
    OPERATOR: frozenset({CONSOLE_READ, LEARNER_READ, LEARNER_ACT, SUPPORT_ACT}),
    OWNER: frozenset({CONSOLE_READ, LEARNER_READ, LEARNER_ACT, SUPPORT_ACT, ADMIN_MANAGE}),
}

#: Permissions that change something. Every one of them needs a step-up inside the reauth window.
#: Derived rather than listed a second time, so adding a write permission cannot forget the rule.
WRITE_PERMISSIONS: frozenset[str] = frozenset({LEARNER_ACT, SUPPORT_ACT, ADMIN_MANAGE})


def permissions_for(role: str) -> frozenset[str]:
    return PERMISSIONS.get(role, frozenset())


# --- errors ---------------------------------------------------------------------------------------
class AdminDenied(Exception):
    """A refusal, with the code that goes to the audit and the message that goes to the screen.

    The message is deliberately NOT a description of why for a caller who is not in the register.
    Somebody probing this door with a learner's token learns only that it is not for them; the
    difference between "expired session" and "not an admin" is told only to people who are
    already admins, because that difference is useful to an attacker and useless to a stranger.
    """

    def __init__(self, code: str, message: str, *, status: int = 403) -> None:
        self.code = code
        self.status = status
        self.message = message
        super().__init__(f"{code}: {message}")

    def http(self) -> HTTPException:
        return HTTPException(
            status_code=self.status, detail={"code": self.code, "message": self.message}
        )


#: What a caller who is not in the register is told. One sentence, no detail, same for every cause.
NOT_FOR_YOU = "This area is not available on this account."

#: THE ONE REFUSAL CODE for a registered caller who may not do this. The panel gate (a desk they
#: do not hold) and the permission gate (an action their seat does not carry) both answer with it,
#: because docs/CONSOLE-ROLES-AND-BOARD.md §2 makes "what they can see" and "what they can do" one
#: list, and a console that says two words for one rule teaches its own client two code paths.
NOT_PERMITTED = "not_permitted"

#: The audit action every such refusal is written under. The law: "the audit records every
#: attempt". The detail row says which gate refused (a ``capability`` or a ``permission``), so
#: one action is enough to read the trail by.
DENIED_ACTION = f"admin.denied.{NOT_PERMITTED}"


class StoreUnavailable(Exception):
    """The register or the trail could not be reached. The door stays shut; nothing is assumed."""


class BadIdentifier(StoreUnavailable):
    """The VALUE was not an id. The store is fine; the input was not, and they are different facts.

    A subclass of :class:`StoreUnavailable` on purpose, so every existing ``except`` keeps failing
    closed and nothing can accidentally start serving on a malformed id. Routes that take an id
    from a caller catch this one FIRST and answer 400 — "that is not an id" — instead of 503, "I
    could not read the trail just now".

    That distinction is the console's own honesty rule turned on the operator's inputs. During an
    incident, "the console is blind" and "you typed it wrong" lead to completely different next
    hours, and a console built so an operator can tell "we could not ask" from "it is fine" must
    not fold the third case into the first.
    """


# --- the records ----------------------------------------------------------------------------------
@dataclass(frozen=True)
class Admin:
    id: str
    #: The Supabase auth user id. ``None`` while this row is an INVITATION — a seat the owner has
    #: created by address, which grants nothing until the account that proves that address signs
    #: in and :func:`open_session` binds it. See migration 0029.
    subject_id: str | None
    email: str
    role: str
    status: str = "active"
    mfa_required: bool = True
    #: What the owner has explicitly added to this person's role, and taken away from it. Two sets
    #: rather than one map so the record stays frozen and hashable; ``ops.admin_capabilities``
    #: holds one row per pair and :func:`console_panels.effective` does the arithmetic.
    grants: frozenset[str] = frozenset()
    revokes: frozenset[str] = frozenset()
    #: Who added this person. Null only for the first row, which by definition nobody granted.
    granted_by: str | None = None

    @property
    def active(self) -> bool:
        return self.status == "active"

    @property
    def invited(self) -> bool:
        """A seat that exists and has never been used. It opens nothing until it is accepted."""
        return self.status == "invited"

    @property
    def capabilities(self) -> frozenset[str]:
        """The EFFECTIVE set: the role's defaults, plus the grants, minus the revocations.

        The screen shows this rather than the theory of a role, which is the law's own wording,
        and the guard asks this rather than the role for every panel.
        """
        return console_panels.effective(self.role, grants=self.grants, revokes=self.revokes)

    def may(self, permission: str) -> bool:
        return permission in permissions_for(self.role)

    def may_panel(self, capability: str) -> bool:
        return capability in self.capabilities


def capabilities_of(admin: Admin | None) -> frozenset[str]:
    """The effective set, or nothing at all. A convenience for callers holding a maybe-admin."""
    return admin.capabilities if admin is not None else frozenset()


@dataclass(frozen=True)
class AdminSession:
    id: str
    admin_id: str
    issued_at: datetime
    expires_at: datetime
    reauth_at: datetime | None = None
    revoked_at: datetime | None = None

    def live(self, now: datetime) -> bool:
        return self.revoked_at is None and now < self.expires_at

    def stepped_up(self, now: datetime, window_s: float) -> bool:
        if self.reauth_at is None:
            return False
        return (now - self.reauth_at).total_seconds() <= window_s


@dataclass(frozen=True)
class AdminContext:
    """What a guarded route knows about its caller. Passed to routes, never built by them."""

    admin: Admin
    session: AdminSession
    request: Request
    ip_hash: str | None = None
    user_agent: str | None = None

    def require(self, permission: str) -> None:
        if not self.admin.may(permission):
            raise AdminDenied(NOT_PERMITTED, f"Your access does not include {permission}.")
        if permission in WRITE_PERMISSIONS and not self.session.stepped_up(
            datetime.now(UTC), reauth_window_s()
        ):
            raise AdminDenied(
                "reauth_required",
                "Confirm it is you before changing anything. Re-enter your code and try again.",
                status=401,
            )

    def audit(
        self,
        action: str,
        *,
        resource_type: str | None = None,
        resource_id: str | None = None,
        decision: str = "allowed",
        status_code: int | None = None,
        detail: dict[str, Any] | None = None,
    ) -> None:
        """Record something more specific than "a request happened" — which learner was opened."""
        record_audit(
            get_store(),
            action=action,
            actor=self.admin,
            session_id=self.session.id,
            request=self.request,
            resource_type=resource_type,
            resource_id=resource_id,
            decision=decision,
            status_code=status_code,
            detail=detail,
            ip_hash=self.ip_hash,
            user_agent=self.user_agent,
        )


# --- environment ----------------------------------------------------------------------------------
def _env(name: str, default: str) -> str:
    return (os.getenv(name) or default).strip()


def _on(value: str) -> bool:
    return value.lower() in {"1", "true", "yes", "on"}


def session_ttl_s() -> int:
    """Thirty minutes, and no refresh. A console over every child in the product does not idle."""
    return max(60, int(_env("ADMIN_SESSION_TTL_S", "1800")))


def reauth_window_s() -> int:
    """How long a step-up counts for. Five minutes: long enough for a task, short enough that a
    walked-away laptop cannot spend."""
    return max(30, int(_env("ADMIN_REAUTH_WINDOW_S", "300")))


def reauth_token_max_age_s() -> int:
    """How fresh the re-authenticated token has to be. Two minutes."""
    return max(30, int(_env("ADMIN_REAUTH_TOKEN_MAX_AGE_S", "120")))


def is_prod() -> bool:
    return _env("ENV", "dev").lower() == "prod"


def mfa_enforced() -> bool:
    """A second factor, and in prod there is no switch that turns it off.

    Off prod, ``ADMIN_REQUIRE_MFA=0`` relaxes it so a local run does not need a TOTP app; the
    default is still on. In prod the environment is not consulted at all, because "the console
    that can read every child was single-factor because somebody set a variable" is not a sentence
    this repo is going to contain. :func:`validate_admin_env` refuses the variable at boot so the
    operator is told rather than quietly overruled.
    """
    if is_prod():
        return True
    return _on(_env("ADMIN_REQUIRE_MFA", "1"))


def _project_configured() -> bool:
    """Would :func:`build_store` reach a REAL register? A project url and a service-role key.

    Without both, ``build_store`` returns :class:`UnconfiguredAdminStore`, which refuses every
    call — so a local run with the dev seam on has nothing to reach and nothing to protect.
    """
    return bool(
        os.getenv("SUPABASE_URL")
        and (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY"))
    )


def validate_admin_env() -> None:
    """Fail fast: the console must never boot on a relaxed setting, a memory store, or a dev seam.

    Called from :func:`wobo_gateway.app.validate_env` at start-up, not only from
    :func:`build_store`. That matters: ``build_store`` runs lazily on the FIRST admin request, so
    a gateway misconfigured this way used to boot, serve every learner for a week, and surface the
    problem as a 500 the first time somebody opened the console. It failed closed, which is the
    important half, but it told the operator at the worst possible moment.
    """
    # THE DEV SEAM AND A REAL REGISTER MUST NEVER MEET, at any ENV.
    #
    # ``auth.authenticate`` mints a Principal straight from ``X-Wobo-Dev-Subject`` when DEV_AUTH is
    # on, with no token and no signature — and ``app.validate_env`` only refuses that combination
    # in prod. So on a staging box (ENV=stg, DEV_AUTH=1), which usually points at the PRODUCTION
    # Supabase project, one header naming a registered admin's subject was a console session: the
    # register's own claim that a principal is "never from a header" was false everywhere but prod.
    # The second factor was the only thing left standing, and an admin row with mfa_required=false
    # (or ADMIN_REQUIRE_MFA=0, which is permitted off prod) takes that away too.
    #
    # The rule, therefore, is about the STORE and not about the environment: a header-asserted
    # identity may reach a throwaway in-memory register, and may never reach a real one.
    if (
        dev_auth_requested()
        and _project_configured()
        and _env("ADMIN_STORE", "").lower() != "memory"
    ):
        raise RuntimeError(
            "DEV_AUTH is refused while the admin console has a real register: the dev header "
            "asserts an identity with no proof, so it would be an unauthenticated console over "
            "whatever project SUPABASE_URL points at. Unset DEV_AUTH, or set ADMIN_STORE=memory "
            "for local work."
        )
    if not is_prod():
        return
    if not _on(_env("ADMIN_REQUIRE_MFA", "1")):
        raise RuntimeError(
            "ADMIN_REQUIRE_MFA=0 is refused when ENV=prod: the admin console is never single-factor"
        )
    if _env("ADMIN_STORE", "").lower() == "memory":
        raise RuntimeError(
            "ADMIN_STORE=memory is refused when ENV=prod: an admin register held in one process's "
            "memory is a register anybody can rebuild by restarting the container"
        )


_IP_SALT = os.getenv("IP_LOG_SALT", "").encode() or os.urandom(16)


def ip_fingerprint(ip: str) -> str:
    """The same posture as the request log: a keyed digest, never the address.

    Our learners are minors and our admins are people; an investigation only ever asks "the same
    caller or not", which a digest answers without a table full of home addresses.
    """
    return hashlib.blake2b(ip.encode(), key=_IP_SALT[:64], digest_size=8).hexdigest()


def client_ip(request: Request) -> str:
    """The last hop, matching ``app._client_ip``: every proxy APPENDS, so the first entry in
    ``X-Forwarded-For`` is whatever the caller typed and the last is what our platform wrote."""
    if os.getenv("TRUST_PROXY") == "1":
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
            if hops:
                return hops[-1]
    return request.client.host if request.client else "unknown"


def session_token(request: Request) -> str:
    """The console session token, from the header or the cookie. Never from a query string.

    A credential in a URL is a credential in the access log, in the referrer of every outbound
    link, and in the browser history of whichever machine the operator happened to be at.
    """
    header = (request.headers.get(SESSION_HEADER) or "").strip()
    if header:
        return header
    return (request.cookies.get(SESSION_COOKIE) or "").strip()


def hash_token(token: str) -> str:
    """SHA-256 hex. The token is opaque and high-entropy, so a plain digest is the right shape:
    there is no dictionary to attack and nothing to slow an attacker down for."""
    return hashlib.sha256(token.encode()).hexdigest()


# --- the store seam ------------------------------------------------------------------------------
class AdminStore(Protocol):
    def admin_by_subject(self, subject: str) -> Admin | None: ...

    def admin_by_id(self, admin_id: str) -> Admin | None: ...

    def admin_by_email(self, email: str) -> Admin | None: ...

    def list_admins(self) -> list[Admin]: ...

    def upsert_admin(
        self,
        *,
        subject_id: str | None,
        email: str,
        role: str,
        granted_by: str | None,
        mfa_required: bool,
        status: str = "active",
    ) -> Admin: ...

    def bind_subject(self, admin_id: str, subject_id: str) -> Admin | None: ...

    def set_admin_status(self, admin_id: str, status: str) -> Admin | None: ...

    def set_capability(
        self,
        *,
        admin_id: str,
        capability: str,
        effect: str,
        granted_by: str | None,
        note: str | None = None,
    ) -> None: ...

    def count_active_owners(self) -> int: ...

    def revoke_sessions_for_admin(self, admin_id: str, when: datetime, reason: str) -> int: ...

    def touch_admin(self, admin_id: str, when: datetime) -> None: ...

    def create_session(
        self,
        *,
        admin_id: str,
        token_hash: str,
        expires_at: datetime,
        reauth_at: datetime | None,
        ip_hash: str | None,
        user_agent: str | None,
    ) -> AdminSession: ...

    def session_by_token_hash(self, token_hash: str) -> AdminSession | None: ...

    def mark_session_used(self, session_id: str, when: datetime) -> None: ...

    def mark_reauth(self, session_id: str, when: datetime) -> AdminSession | None: ...

    def revoke_session(self, session_id: str, when: datetime, reason: str) -> None: ...

    def insert_audit(self, row: dict[str, Any]) -> None: ...

    def list_audit(self, *, limit: int, actor_subject: str | None) -> list[dict[str, Any]]: ...


class UnconfiguredAdminStore:
    """No project configured, so no admin exists. Every call raises and the door stays shut.

    This is the opposite of the billing store's posture and for the opposite reason: an
    unconfigured subscription store that guesses "free" costs a learner money, and an unconfigured
    ADMIN store that guesses anything costs every learner their privacy. Fail closed, loudly.
    """

    def _refuse(self) -> StoreUnavailable:
        return StoreUnavailable("no admin store is configured")

    def __getattr__(self, _name: str) -> Any:
        def call(*_a: Any, **_k: Any) -> Any:
            raise self._refuse()

        return call


class InMemoryAdminStore:
    """The suite's store and a local run. Refused in prod by :func:`validate_admin_env`."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.admins: dict[str, Admin] = {}
        self.sessions: dict[str, dict[str, Any]] = {}
        self.audit: list[dict[str, Any]] = []
        #: ``admin_id -> {capability: 'grant' | 'revoke'}``. The in-memory shape of
        #: ``ops.admin_capabilities``; a capability with no row here is whatever the role starts
        #: with, which is why "put it back" deletes rather than writing a third value.
        self.capabilities: dict[str, dict[str, str]] = {}

    # -- register
    def _held(self, admin: Admin) -> Admin:
        """One record with its capability rows folded in. The store never hands out a bare role."""
        rows = self.capabilities.get(admin.id, {})
        return replace(
            admin,
            grants=frozenset(c for c, e in rows.items() if e == "grant"),
            revokes=frozenset(c for c, e in rows.items() if e == "revoke"),
        )

    def admin_by_subject(self, subject: str) -> Admin | None:
        with self._lock:
            for admin in self.admins.values():
                if subject and admin.subject_id == subject:
                    return self._held(admin)
        return None

    def admin_by_id(self, admin_id: str) -> Admin | None:
        with self._lock:
            found = self.admins.get(admin_id)
            return self._held(found) if found else None

    def admin_by_email(self, email: str) -> Admin | None:
        wanted = (email or "").strip().lower()
        with self._lock:
            for admin in self.admins.values():
                if wanted and admin.email.lower() == wanted and admin.status != "suspended":
                    return self._held(admin)
        return None

    def list_admins(self) -> list[Admin]:
        with self._lock:
            return [self._held(a) for a in sorted(self.admins.values(), key=lambda a: a.email)]

    def upsert_admin(
        self,
        *,
        subject_id: str | None,
        email: str,
        role: str,
        granted_by: str | None,
        mfa_required: bool,
        status: str = "active",
    ) -> Admin:
        with self._lock:
            for existing in self.admins.values():
                same_account = bool(subject_id) and existing.subject_id == subject_id
                same_address = existing.email.lower() == email.lower() != ""
                if same_account or (same_address and existing.status != "suspended"):
                    updated = replace(
                        existing,
                        subject_id=subject_id or existing.subject_id,
                        email=email,
                        role=role,
                        status=status,
                        mfa_required=mfa_required,
                        granted_by=granted_by or existing.granted_by,
                    )
                    self.admins[existing.id] = updated
                    return self._held(updated)
            admin_id = secrets.token_hex(16)
            admin = Admin(
                id=admin_id,
                subject_id=subject_id,
                email=email,
                role=role,
                status=status,
                mfa_required=mfa_required,
                granted_by=granted_by,
            )
            self.admins[admin_id] = admin
            return self._held(admin)

    def bind_subject(self, admin_id: str, subject_id: str) -> Admin | None:
        with self._lock:
            current = self.admins.get(admin_id)
            if current is None:
                return None
            updated = replace(current, subject_id=subject_id, status="active")
            self.admins[admin_id] = updated
            return self._held(updated)

    def set_admin_status(self, admin_id: str, status: str) -> Admin | None:
        with self._lock:
            current = self.admins.get(admin_id)
            if current is None:
                return None
            updated = replace(current, status=status)
            self.admins[admin_id] = updated
            return self._held(updated)

    def set_capability(
        self,
        *,
        admin_id: str,
        capability: str,
        effect: str,
        granted_by: str | None,
        note: str | None = None,
    ) -> None:
        with self._lock:
            rows = self.capabilities.setdefault(admin_id, {})
            if effect == "default":
                rows.pop(capability, None)
            else:
                rows[capability] = effect

    def count_active_owners(self) -> int:
        with self._lock:
            return sum(1 for a in self.admins.values() if a.role == OWNER and a.status == "active")

    def revoke_sessions_for_admin(self, admin_id: str, when: datetime, reason: str) -> int:
        ended = 0
        with self._lock:
            for key, held in self.sessions.items():
                session: AdminSession = held["session"]
                if session.admin_id != admin_id or session.revoked_at is not None:
                    continue
                self.sessions[key]["session"] = replace(session, revoked_at=when)
                ended += 1
        return ended

    def touch_admin(self, admin_id: str, when: datetime) -> None:
        return None

    # -- sessions
    def create_session(
        self,
        *,
        admin_id: str,
        token_hash: str,
        expires_at: datetime,
        reauth_at: datetime | None,
        ip_hash: str | None,
        user_agent: str | None,
    ) -> AdminSession:
        with self._lock:
            session = AdminSession(
                id=secrets.token_hex(16),
                admin_id=admin_id,
                issued_at=datetime.now(UTC),
                expires_at=expires_at,
                reauth_at=reauth_at,
            )
            self.sessions[token_hash] = {"session": session, "ip_hash": ip_hash, "ua": user_agent}
            return session

    def _find_session(self, session_id: str) -> str | None:
        for key, held in self.sessions.items():
            if held["session"].id == session_id:
                return key
        return None

    def session_by_token_hash(self, token_hash: str) -> AdminSession | None:
        with self._lock:
            held = self.sessions.get(token_hash)
            return held["session"] if held else None

    def mark_session_used(self, session_id: str, when: datetime) -> None:
        return None

    def mark_reauth(self, session_id: str, when: datetime) -> AdminSession | None:
        with self._lock:
            key = self._find_session(session_id)
            if key is None:
                return None
            current: AdminSession = self.sessions[key]["session"]
            updated = AdminSession(
                id=current.id,
                admin_id=current.admin_id,
                issued_at=current.issued_at,
                expires_at=current.expires_at,
                reauth_at=when,
                revoked_at=current.revoked_at,
            )
            self.sessions[key]["session"] = updated
            return updated

    def revoke_session(self, session_id: str, when: datetime, reason: str) -> None:
        with self._lock:
            key = self._find_session(session_id)
            if key is None:
                return None
            current: AdminSession = self.sessions[key]["session"]
            self.sessions[key]["session"] = AdminSession(
                id=current.id,
                admin_id=current.admin_id,
                issued_at=current.issued_at,
                expires_at=current.expires_at,
                reauth_at=current.reauth_at,
                revoked_at=when,
            )
        return None

    # -- audit
    def insert_audit(self, row: dict[str, Any]) -> None:
        with self._lock:
            self.audit.append(dict(row))

    def list_audit(self, *, limit: int, actor_subject: str | None) -> list[dict[str, Any]]:
        with self._lock:
            rows = [r for r in self.audit if actor_subject in (None, r.get("actor_subject"))]
            return list(reversed(rows))[:limit]


def _request(url: str, key: str, method: str, *, body: Any = None, want_rows: bool) -> Any:
    """One PostgREST call against the ``ops`` schema. Split out so tests substitute it."""
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Accept-Profile": _SCHEMA,
        "Content-Profile": _SCHEMA,
        "Prefer": "return=representation" if want_rows else "return=minimal",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:  # noqa: S310
        raw = response.read().decode() or ""
    if not want_rows or not raw.strip():
        return []
    return json.loads(raw)


_NETWORK_ERRORS = (urllib.error.URLError, TimeoutError, ValueError, OSError)


def _when(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.astimezone(UTC)
    try:
        text = str(value).replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed.astimezone(UTC) if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _iso(moment: datetime | None) -> str | None:
    return moment.astimezone(UTC).isoformat() if moment else None


def _admin_from_row(row: dict[str, Any]) -> Admin | None:
    """One register row, with its capability rows folded in where the select embedded them.

    ``subject_id`` may be null now: an invitation is a seat that exists before its account does
    (migration 0029). What cannot be missing is the row's own id — without it nothing downstream
    can name this person in the trail — so that, and not the subject, is the test for a usable row.
    """
    admin_id = str(row.get("id") or "")
    if not admin_id:
        return None
    subject = str(row.get("subject_id") or "") or None
    held = row.get("admin_capabilities")
    grants: set[str] = set()
    revokes: set[str] = set()
    if isinstance(held, list):
        for entry in held:
            if not isinstance(entry, dict):
                continue
            name = str(entry.get("capability") or "")
            effect = str(entry.get("effect") or "")
            if effect == "grant":
                grants.add(name)
            elif effect == "revoke":
                revokes.add(name)
    return Admin(
        id=admin_id,
        subject_id=subject,
        email=str(row.get("email") or ""),
        role=str(row.get("role") or VIEWER),
        status=str(row.get("status") or "active"),
        mfa_required=row.get("mfa_required") is not False,
        grants=frozenset(grants),
        revokes=frozenset(revokes),
        granted_by=str(row.get("granted_by") or "") or None,
    )


def _session_from_row(row: dict[str, Any]) -> AdminSession | None:
    expires = _when(row.get("expires_at"))
    if expires is None:
        return None
    return AdminSession(
        id=str(row.get("id") or ""),
        admin_id=str(row.get("admin_id") or ""),
        issued_at=_when(row.get("issued_at")) or datetime.now(UTC),
        expires_at=expires,
        reauth_at=_when(row.get("reauth_at")),
        revoked_at=_when(row.get("revoked_at")),
    )


class PostgrestAdminStore:
    """``ops.*`` over PostgREST with the service-role key.

    The learner role holds no grant on ``ops.admins`` or ``ops.admin_sessions`` at all (migration
    0015), so nothing but this class can read or change them, and ``ops.admin_audit`` refuses
    UPDATE and DELETE even to this key.
    """

    def __init__(self, base_url: str, service_key: str, *, request: Any = None) -> None:
        if not base_url or not service_key:
            raise ValueError("PostgrestAdminStore needs a project URL and a service key")
        self.base = base_url.rstrip("/")
        self._key = service_key
        self._request = request or _request

    def _url(self, table: str, params: dict[str, str]) -> str:
        encoded = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
        return f"{self.base}/rest/v1/{table}?{encoded}"

    def _call(
        self, method: str, table: str, params: dict[str, str], *, body: Any = None
    ) -> list[dict[str, Any]]:
        try:
            rows = self._request(
                self._url(table, params), self._key, method, body=body, want_rows=True
            )
        except _NETWORK_ERRORS as exc:
            logger.warning(
                "admin: store call failed",
                extra={"fields": {"method": method, "table": table, "error": str(exc)}},
            )
            raise StoreUnavailable(str(exc)) from exc
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    @staticmethod
    def _uuid(value: str) -> str:
        """A filter value is interpolated into a query string, so it is checked, never trusted.

        PostgREST's filter grammar has its own metacharacters (``,``, ``.``, ``(``): a value that
        carried them could change which rows a filter matches. Every id this class puts into a
        filter is a uuid or it is not used at all.
        """
        if not _UUID_RE.match(value or ""):
            raise BadIdentifier("that is not an id I can look up")
        return value

    @staticmethod
    def _capability(value: str) -> str:
        """A capability name is put into a filter, so it is checked against the vocabulary.

        Not a character class but the LIST: only a name this console actually has can be written,
        so a row that grants something nobody implemented can never exist to be misread later.
        """
        if value not in console_panels.CAPABILITIES:
            raise BadIdentifier("that is not a capability this console has")
        return value

    @staticmethod
    def _digest(value: str) -> str:
        if not re.fullmatch(r"[0-9a-f]{64}", value or ""):
            raise BadIdentifier("that is not a token I can look up")
        return value

    #: The register row AND its capability rows in one call. PostgREST embeds the child table
    #: through the foreign key, so the guard still makes one request per admin lookup rather than
    #: two — a door that costs two round trips on every request is a door people route around.
    _WITH_CAPABILITIES = "*,admin_capabilities(capability,effect)"

    def admin_by_subject(self, subject: str) -> Admin | None:
        rows = self._call(
            "GET",
            "admins",
            {
                "select": self._WITH_CAPABILITIES,
                "subject_id": f"eq.{self._uuid(subject)}",
                "limit": "1",
            },
        )
        return _admin_from_row(rows[0]) if rows else None

    def admin_by_id(self, admin_id: str) -> Admin | None:
        rows = self._call(
            "GET",
            "admins",
            {"select": self._WITH_CAPABILITIES, "id": f"eq.{self._uuid(admin_id)}", "limit": "1"},
        )
        return _admin_from_row(rows[0]) if rows else None

    def admin_by_email(self, email: str) -> Admin | None:
        """Used only to accept an invitation, so a suspended row can never be matched into life."""
        wanted = (email or "").strip().lower()
        if not wanted or "@" not in wanted or any(c in wanted for c in ",.()"):
            # The address goes into a PostgREST filter, whose grammar uses these as operators.
            # An address that carries one is not looked up at all.
            raise BadIdentifier("that is not an address I can look up")
        rows = self._call(
            "GET",
            "admins",
            {
                "select": self._WITH_CAPABILITIES,
                "email": f"ilike.{wanted}",
                "status": "neq.suspended",
                "limit": "2",
            },
        )
        found = [a for a in (_admin_from_row(r) for r in rows) if a is not None]
        return found[0] if len(found) == 1 else None

    def list_admins(self) -> list[Admin]:
        rows = self._call(
            "GET",
            "admins",
            {"select": self._WITH_CAPABILITIES, "order": "email.asc", "limit": "200"},
        )
        return [a for a in (_admin_from_row(r) for r in rows) if a is not None]

    def upsert_admin(
        self,
        *,
        subject_id: str | None,
        email: str,
        role: str,
        granted_by: str | None,
        mfa_required: bool,
        status: str = "active",
    ) -> Admin:
        body = {
            "subject_id": self._uuid(subject_id) if subject_id else None,
            "email": email,
            "role": role,
            "status": status,
            "mfa_required": mfa_required,
            "granted_by": granted_by,
            "updated_at": _iso(datetime.now(UTC)),
        }
        # An invitation has no subject to conflict on, so the conflict target is the address; a
        # re-grant to somebody who already has an account still keys on the account.
        conflict = "subject_id" if subject_id else "email"
        rows = self._call(
            "POST",
            "admins",
            {"select": "*", "on_conflict": conflict},
            body=[body],
        )
        admin = _admin_from_row(rows[0]) if rows else None
        if admin is None:
            raise StoreUnavailable("the grant did not land")
        return admin

    def bind_subject(self, admin_id: str, subject_id: str) -> Admin | None:
        """Accepting an invitation: the seat gets its account, and only the first time.

        ``subject_id=is.null`` is in the filter rather than in a read-then-write, so two people
        racing the same invitation cannot both bind it: the second PATCH matches no row.
        """
        rows = self._call(
            "PATCH",
            "admins",
            {
                "id": f"eq.{self._uuid(admin_id)}",
                "subject_id": "is.null",
                "select": self._WITH_CAPABILITIES,
            },
            body={
                "subject_id": self._uuid(subject_id),
                "status": "active",
                "updated_at": _iso(datetime.now(UTC)),
            },
        )
        return _admin_from_row(rows[0]) if rows else None

    def set_admin_status(self, admin_id: str, status: str) -> Admin | None:
        rows = self._call(
            "PATCH",
            "admins",
            {"id": f"eq.{self._uuid(admin_id)}", "select": self._WITH_CAPABILITIES},
            body={"status": status, "updated_at": _iso(datetime.now(UTC))},
        )
        return _admin_from_row(rows[0]) if rows else None

    def set_capability(
        self,
        *,
        admin_id: str,
        capability: str,
        effect: str,
        granted_by: str | None,
        note: str | None = None,
    ) -> None:
        """Write one grant or revocation, or delete the row to put the role's default back."""
        if effect == "default":
            self._call(
                "DELETE",
                "admin_capabilities",
                {
                    "admin_id": f"eq.{self._uuid(admin_id)}",
                    "capability": f"eq.{self._capability(capability)}",
                    "select": "id",
                },
            )
            return
        self._call(
            "POST",
            "admin_capabilities",
            {"select": "id", "on_conflict": "admin_id,capability"},
            body=[
                {
                    "admin_id": self._uuid(admin_id),
                    "capability": self._capability(capability),
                    "effect": effect,
                    "granted_by": granted_by,
                    "at": _iso(datetime.now(UTC)),
                    "note": (note or None),
                }
            ],
        )

    def count_active_owners(self) -> int:
        rows = self._call(
            "GET",
            "admins",
            {"select": "id", "role": "eq.owner", "status": "eq.active", "limit": "10"},
        )
        return len(rows)

    def revoke_sessions_for_admin(self, admin_id: str, when: datetime, reason: str) -> int:
        """Suspending is instant: every live session of theirs is revoked in one statement."""
        rows = self._call(
            "PATCH",
            "admin_sessions",
            {
                "admin_id": f"eq.{self._uuid(admin_id)}",
                "revoked_at": "is.null",
                "select": "id",
            },
            body={"revoked_at": _iso(when), "revoked_reason": reason[:200]},
        )
        return len(rows)

    def touch_admin(self, admin_id: str, when: datetime) -> None:
        self._call(
            "PATCH",
            "admins",
            {"id": f"eq.{self._uuid(admin_id)}", "select": "id"},
            body={"last_seen_at": _iso(when)},
        )

    def create_session(
        self,
        *,
        admin_id: str,
        token_hash: str,
        expires_at: datetime,
        reauth_at: datetime | None,
        ip_hash: str | None,
        user_agent: str | None,
    ) -> AdminSession:
        rows = self._call(
            "POST",
            "admin_sessions",
            {"select": "*"},
            body=[
                {
                    "admin_id": self._uuid(admin_id),
                    "token_hash": self._digest(token_hash),
                    "expires_at": _iso(expires_at),
                    "reauth_at": _iso(reauth_at),
                    "ip_hash": ip_hash,
                    "user_agent": user_agent,
                }
            ],
        )
        session = _session_from_row(rows[0]) if rows else None
        if session is None:
            raise StoreUnavailable("the session did not open")
        return session

    def session_by_token_hash(self, token_hash: str) -> AdminSession | None:
        rows = self._call(
            "GET",
            "admin_sessions",
            {"select": "*", "token_hash": f"eq.{self._digest(token_hash)}", "limit": "1"},
        )
        return _session_from_row(rows[0]) if rows else None

    def mark_session_used(self, session_id: str, when: datetime) -> None:
        self._call(
            "PATCH",
            "admin_sessions",
            {"id": f"eq.{self._uuid(session_id)}", "select": "id"},
            body={"last_used_at": _iso(when)},
        )

    def mark_reauth(self, session_id: str, when: datetime) -> AdminSession | None:
        rows = self._call(
            "PATCH",
            "admin_sessions",
            {"id": f"eq.{self._uuid(session_id)}", "select": "*"},
            body={"reauth_at": _iso(when)},
        )
        return _session_from_row(rows[0]) if rows else None

    def revoke_session(self, session_id: str, when: datetime, reason: str) -> None:
        self._call(
            "PATCH",
            "admin_sessions",
            {"id": f"eq.{self._uuid(session_id)}", "select": "id"},
            body={"revoked_at": _iso(when), "revoked_reason": reason[:200]},
        )

    def insert_audit(self, row: dict[str, Any]) -> None:
        self._call("POST", "admin_audit", {"select": "id"}, body=[row])

    def list_audit(self, *, limit: int, actor_subject: str | None) -> list[dict[str, Any]]:
        params = {"select": "*", "order": "id.desc", "limit": str(max(1, min(limit, 500)))}
        if actor_subject:
            params["actor_subject"] = f"eq.{self._uuid(actor_subject)}"
        return self._call("GET", "admin_audit", params)


_store: AdminStore | None = None
_store_lock = threading.Lock()


def build_store() -> AdminStore:
    """The project store when configured; a refusing store when not. Never a permissive guess."""
    validate_admin_env()
    if _env("ADMIN_STORE", "").lower() == "memory":
        return InMemoryAdminStore()
    base = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if base and key:
        return PostgrestAdminStore(base, key)
    logger.error(
        "admin: no project configured — the console will refuse every request. Set SUPABASE_URL "
        "and SUPABASE_SERVICE_ROLE_KEY, or ADMIN_STORE=memory (never in prod) for local work."
    )
    return UnconfiguredAdminStore()


def get_store() -> AdminStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = build_store()
    return _store


def set_store(store: AdminStore | None) -> None:
    """Test and operator seam."""
    global _store
    with _store_lock:
        _store = store


# --- the trail -----------------------------------------------------------------------------------
def record_audit(
    store: AdminStore,
    *,
    action: str,
    actor_subject: str | None = None,
    actor: Admin | None = None,
    session_id: str | None = None,
    request: Request | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    decision: str = "allowed",
    status_code: int | None = None,
    detail: dict[str, Any] | None = None,
    ip_hash: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Write one row. Raises :class:`StoreUnavailable` — the caller decides, and the guard denies.

    Nothing a learner wrote goes in ``detail``: the console's job is to know that a learner has a
    problem, not to read their homework, and a trail full of quoted content is a second copy of
    everything the console was built to touch carefully.
    """
    row: dict[str, Any] = {
        "action": action[:120],
        "actor_subject": (actor.subject_id if actor else actor_subject) or "",
        "actor_admin_id": actor.id if actor else None,
        "actor_email": actor.email if actor else None,
        "actor_role": actor.role if actor else None,
        "session_id": session_id,
        "resource_type": resource_type,
        "resource_id": resource_id[:200] if resource_id else None,
        "decision": decision,
        "detail": detail or {},
    }
    if request is not None:
        row["method"] = request.method
        row["path"] = request.url.path[:512]
        row["ip_hash"] = ip_hash if ip_hash is not None else ip_fingerprint(client_ip(request))
        row["user_agent"] = (
            user_agent
            if user_agent is not None
            else (request.headers.get("user-agent") or "")[:256] or None
        )
    if status_code is not None:
        row["status_code"] = status_code
    store.insert_audit(row)


# --- the login limiter ---------------------------------------------------------------------------
#
# The console's own bucket, on top of the app's. Two windows, because they answer two questions:
# a per-subject window bounds one signed-in account, and a per-address window bounds somebody
# working through a list of stolen tokens from one machine. Both are fixed-window and per process,
# like the rest of the gateway's limiters; the note in app.py about Redis applies here too.
_hits: dict[tuple[str, int], int] = {}
_hits_lock = threading.Lock()


def _over(key: str, ceiling: int) -> bool:
    window = int(time.time() // 60)
    bucket = (key, window)
    with _hits_lock:
        if len(_hits) > 4096:
            for stale in [b for b in _hits if b[1] < window]:
                del _hits[stale]
        _hits[bucket] = _hits.get(bucket, 0) + 1
        return _hits[bucket] > ceiling


def reset_limiter() -> None:
    """Test seam."""
    with _hits_lock:
        _hits.clear()


def _login_ceiling() -> int:
    return max(1, int(_env("ADMIN_LOGIN_LIMIT_PER_MINUTE", "5")))


def _request_ceiling() -> int:
    return max(1, int(_env("ADMIN_RATE_LIMIT_PER_MINUTE", "60")))


def _too_many() -> AdminDenied:
    """A fresh exception each time — a shared instance accumulates one traceback per raise."""
    return AdminDenied(
        "too_many_attempts", "Too many attempts. Wait a minute and try again.", status=429
    )


# --- the guard -----------------------------------------------------------------------------------
def _principal(request: Request) -> Any:
    """The verified learner-grade identity the middleware already established. Never a header."""
    return getattr(request.state, "principal", None)


def _claim_aal(principal: Any) -> str:
    claims = getattr(principal, "claims", None) or {}
    return str(claims.get("aal") or "")


def _claim_email(principal: Any) -> str:
    """The address this token proves, or nothing.

    An unconfirmed address is not proof of anything — anybody can type somebody else's into a
    sign-up form — so a token whose ``email_verified`` is explicitly false is treated as carrying
    no address at all. Supabase writes that claim into ``user_metadata``; older projects put it at
    the top level, and both are read.
    """
    claims = getattr(principal, "claims", None) or {}
    email = str(claims.get("email") or "").strip().lower()
    if not email or "@" not in email:
        return ""
    metadata = claims.get("user_metadata")
    verified = claims.get("email_verified")
    if isinstance(metadata, dict) and "email_verified" in metadata:
        verified = metadata.get("email_verified")
    return "" if verified is False else email


def _invitation_for(store: AdminStore, principal: Any) -> Admin | None:
    """An unaccepted seat waiting for the address this token proves. Never an active one.

    The check that it is still ``invited`` is what keeps this from being a way IN: a row that
    already has an account is matched by subject or not at all, so proving somebody else's address
    can never reach somebody else's seat.
    """
    email = _claim_email(principal)
    if not email:
        return None
    try:
        found = store.admin_by_email(email)
    except BadIdentifier:
        return None
    if found is None or not found.invited or found.subject_id is not None:
        return None
    return found


def _refuse_stranger(request: Request, code: str, subject: str | None) -> AdminDenied:
    """One refusal, one log line, and NO audit row.

    A stranger's failed knock must not be able to write to the audit table — that is a
    denial-of-service on the trail itself, and the trail is append-only so it cannot be tidied up
    afterwards. Callers who are actually in the register DO get audited on refusal (that is the
    interesting case: a suspended admin, an expired session, a missing step-up).
    """
    logger.warning(
        "admin: refused",
        extra={
            "fields": {
                "code": code,
                "path": request.url.path,
                "subject_present": bool(subject),
                "ip": ip_fingerprint(client_ip(request)),
            }
        },
    )
    return AdminDenied(code, NOT_FOR_YOU)


def resolve_context(request: Request) -> AdminContext:
    """Turn a request into an :class:`AdminContext`, or raise. The whole door, in one function.

    Order matters and is deliberate:
      1. limiter — before any store call, so a flood costs the database nothing;
      2. verified principal — set by the app middleware from a signed token, never from a header;
      3. the REGISTER — a row, active; a learner token alone stops here;
      4. the second factor — aal2 when this admin requires it;
      5. the console session — present, ours, live, and belonging to this same admin;
      6. the audit — written before the endpoint runs, and a failure to write is a refusal.
    """
    now = datetime.now(UTC)
    ip = client_ip(request)
    ip_hash = ip_fingerprint(ip)
    principal = _principal(request)
    subject = getattr(principal, "subject", None)
    ua = (request.headers.get("user-agent") or "")[:256] or None

    if _over(f"admin:{subject or ip_hash}", _request_ceiling()):
        raise _too_many()

    if principal is None or not subject or getattr(principal, "anonymous", False):
        raise _refuse_stranger(request, "no_identity", subject)

    store = get_store()
    try:
        admin = store.admin_by_subject(subject)
    except StoreUnavailable as exc:
        # The register could not be read, so we do not know who this is. Not knowing is a refusal.
        logger.error("admin: register unreadable", extra={"fields": {"error": str(exc)}})
        raise AdminDenied(
            "register_unavailable",
            "I could not check your access just now. Nothing has changed.",
            status=503,
        ) from exc

    if admin is None:
        raise _refuse_stranger(request, "not_registered", subject)
    if not admin.active:
        raise _refuse_stranger(request, "suspended", subject)

    if mfa_enforced() and admin.mfa_required and _claim_aal(principal) != "aal2":
        _audit_denial(store, request, admin, "admin.denied.mfa", ip_hash, ua)
        raise AdminDenied(
            "mfa_required",
            "This console needs your second factor. Enrol or enter your code, then sign in again.",
            status=401,
        )

    token = session_token(request)
    if not token:
        _audit_denial(store, request, admin, "admin.denied.no_session", ip_hash, ua)
        raise AdminDenied(
            "admin_session_required", "Open the console again to continue.", status=401
        )

    try:
        session = store.session_by_token_hash(hash_token(token))
    except StoreUnavailable as exc:
        raise AdminDenied(
            "register_unavailable",
            "I could not check your session just now. Nothing has changed.",
            status=503,
        ) from exc

    # A session that is not ours, not live, or belongs to a DIFFERENT admin. The last one is the
    # one worth naming: without it, any admin's leaked session token would work for any other
    # signed-in admin, which quietly collapses the three levels into one.
    if session is None or not session.live(now) or session.admin_id != admin.id:
        _audit_denial(store, request, admin, "admin.denied.session", ip_hash, ua)
        raise AdminDenied("admin_session_expired", "Your console session has ended.", status=401)

    try:
        record_audit(
            store,
            action="admin.request",
            actor=admin,
            session_id=session.id,
            request=request,
            ip_hash=ip_hash,
            user_agent=ua,
        )
    except StoreUnavailable as exc:
        # No audit, no access. A console that can look at children without leaving a mark is
        # exactly the thing this module exists to prevent, so an unwritable trail closes the door.
        logger.error("admin: audit unwritable, refusing", extra={"fields": {"error": str(exc)}})
        raise AdminDenied(
            "audit_unavailable",
            "I could not record this, so I did not do it. Try again in a moment.",
            status=503,
        ) from exc

    try:
        store.mark_session_used(session.id, now)
        store.touch_admin(admin.id, now)
    except StoreUnavailable:
        # Bookkeeping, not the door: the request already has its audit row.
        logger.warning("admin: could not update session bookkeeping")

    return AdminContext(
        admin=admin, session=session, request=request, ip_hash=ip_hash, user_agent=ua
    )


def _audit_denial(
    store: AdminStore,
    request: Request,
    admin: Admin,
    action: str,
    ip_hash: str,
    user_agent: str | None,
) -> None:
    """A refusal of somebody who IS in the register. Worth recording, and the limiter bounds it."""
    try:
        record_audit(
            store,
            action=action,
            actor=admin,
            request=request,
            decision="denied",
            ip_hash=ip_hash,
            user_agent=user_agent,
        )
    except StoreUnavailable:
        logger.error("admin: could not record a denial")


def _require_panel(ctx: AdminContext) -> None:
    """The panel gate: "its route refuses them with the same message a stranger gets".

    The law is explicit that hiding a desk is not closing it — "the navigation, the search and the
    deep links all obey the same list, so nothing leaks by way of a URL somebody remembers" — so
    this runs on the SERVER, on every guarded request, before the endpoint does anything.

    Two reasons to refuse, and both are the stranger's refusal, word for word:

    * the caller does not hold this panel's capability;
    * NOBODY HAS SAID which panel this path belongs to. That is the fail-closed half, and it is
      why ``console_panels`` is a map rather than a decorator: a desk mounted tomorrow without a
      line in that file answers to nobody, and ``test_console_roles`` walks the built app so the
      omission is a red test rather than a quiet hole.

    ONE CODE. The console has exactly one refusal code for "you may not", ``not_permitted``, and
    this gate speaks it too: the panel gate and the permission gate (:meth:`AdminContext.require`)
    are two checks of the same rule, a person's effective set, and the web client, the desks'
    tests and the audit all key off that one word. The MESSAGE is the stranger's, unchanged, so the
    body still tells a remembered link nothing. The audit action is the same for both gates,
    ``admin.denied.not_permitted``, and the detail says which: the panel that was missing, or the
    path nobody mapped.

    The attempt is audited because this caller IS in the register — that is the interesting case,
    and the one an investigation reads. A stranger's knock still writes nothing (see
    :func:`_refuse_stranger`), so a denial cannot be used to flood the trail.
    """
    path = ctx.request.url.path
    if console_panels.is_identity_path(path):
        return
    capability = console_panels.capability_for(path, ctx.request.method)
    if capability is None:
        logger.error(
            "admin: no panel claims this route, refusing",
            extra={"fields": {"path": path[:512], "method": ctx.request.method}},
        )
        _try_audit(ctx, DENIED_ACTION, {"reason": "unmapped", "path": path[:512]})
        raise AdminDenied(NOT_PERMITTED, NOT_FOR_YOU)
    if not ctx.admin.may_panel(capability):
        _try_audit(ctx, DENIED_ACTION, {"capability": capability})
        raise AdminDenied(NOT_PERMITTED, NOT_FOR_YOU)


def _try_audit(ctx: AdminContext, action: str, detail: dict[str, Any]) -> None:
    """Record a refusal, and never let an unwritable trail turn a refusal into an allowance."""
    try:
        ctx.audit(action, decision="denied", detail=detail)
    except StoreUnavailable:
        logger.error("admin: could not record a denial", extra={"fields": {"action": action}})


def guard(request: Request) -> AdminContext:
    """The one dependency. Carried by :func:`admin_router`, so no route can be added without it."""
    try:
        ctx = resolve_context(request)
        _require_panel(ctx)
        return ctx
    except AdminDenied as denied:
        raise denied.http() from denied


def requires(permission: str) -> Any:
    """Dependency factory: this endpoint needs this permission (and a step-up if it writes)."""

    def dependency(ctx: Annotated[AdminContext, Depends(guard)]) -> AdminContext:
        try:
            ctx.require(permission)
        except AdminDenied as denied:
            ctx.audit(
                f"admin.denied.{denied.code}", decision="denied", detail={"permission": permission}
            )
            raise denied.http() from denied
        return ctx

    return dependency


def admin_router(**kwargs: Any) -> APIRouter:
    """An admin router is guarded BY CONSTRUCTION, and invisible to the published spec.

    ``dependencies`` is on the router, not on each route, so an endpoint added here tomorrow by
    somebody who has never read this file is behind the door anyway.

    ``include_in_schema=False`` is the second half of the same rule, and it is a SECURITY setting
    rather than a tidiness one. ``GET /openapi.json`` is not under ``/v1``, so the app's front
    door never sees it: off prod it answers 200 to anybody, and every admin path it lists publishes
    the operator API map — the route names, the methods and the request and response schemas —
    without a single console module having to leak. FastAPI ANDs a router's flag into every route
    added to it, so a desk written tomorrow is out of the spec for the same reason it is guarded:
    where it lives. :func:`assert_admin_surface` refuses to boot if either half is ever undone.
    """
    deps = list(kwargs.pop("dependencies", []) or [])
    kwargs.setdefault("include_in_schema", False)
    return APIRouter(prefix=ADMIN_PREFIX, dependencies=[Depends(guard), *deps], **kwargs)


def route_dependencies(route: Any) -> list[Any]:
    """Every callable in a route's dependency tree, flattened. Used by the guard test."""
    found: list[Any] = []
    dependant = getattr(route, "dependant", None)
    if dependant is None:
        return found
    stack = [dependant]
    while stack:
        node = stack.pop()
        call = getattr(node, "call", None)
        if call is not None:
            found.append(call)
        stack.extend(getattr(node, "dependencies", []) or [])
    return found


def iter_api_routes(app: FastAPI) -> list[tuple[str, Any, list[Any]]]:
    """Every reachable route in a built app, as ``(path, route, dependencies added on the way)``.

    ``app.routes`` is not a flat list. FastAPI wraps an included router in a holder object rather
    than copying its routes up, and a mounted sub-application is a third shape again — so a check
    that only reads ``app.routes`` sees the admin router as ONE opaque entry and happily reports
    that nothing is unguarded. Walking the tree is what makes the guard test mean anything.
    """
    found: list[tuple[str, Any, list[Any]]] = []
    stack: list[tuple[Any, str, tuple[Any, ...]]] = [(app.router, "", ())]
    seen: set[int] = set()
    while stack:
        node, prefix, inherited = stack.pop()
        if id(node) in seen:
            continue
        seen.add(id(node))
        for route in getattr(node, "routes", []) or []:
            context = getattr(route, "include_context", None)
            if context is not None:  # an included router: unwrap it, keep its added prefix and deps
                sub = getattr(context, "included_router", None) or getattr(
                    route, "original_router", None
                )
                added = tuple(getattr(context, "dependencies", []) or [])
                stack.append(
                    (sub, prefix + (getattr(context, "prefix", "") or ""), inherited + added)
                )
                continue
            path = getattr(route, "path", None)
            if path is None:
                continue
            if getattr(route, "routes", None) and not isinstance(route, APIRoute):
                stack.append((route, prefix + path, inherited))  # a Mount
                continue
            found.append((prefix + path, route, list(inherited)))
    return found


def unguarded_admin_routes(app: FastAPI) -> list[str]:
    """Admin endpoints NOT behind :func:`guard`, as ``"METHOD /path"``. Only the login belongs here.

    Method by method rather than path by path, because ``/v1/admin/session`` is deliberately two
    different things: ``POST`` is the login and cannot require the session it issues, while ``GET``
    and ``DELETE`` on the same path are ordinary guarded endpoints. A path-level check would let
    the second and third hide behind the first.
    """
    loose: list[str] = []
    for path, route, inherited in iter_api_routes(app):
        if not path.startswith(ADMIN_PREFIX):
            continue
        methods = sorted(getattr(route, "methods", None) or {"?"})
        if not isinstance(route, APIRoute):
            loose.extend(f"{m} {path}" for m in methods)
            continue
        # A guard applied at include time counts too — what matters is that the check runs, not
        # which of the two places it was declared in.
        include_time = [getattr(d, "dependency", None) for d in inherited]
        if guard not in route_dependencies(route) and guard not in include_time:
            loose.extend(f"{m} {path}" for m in methods if m != "HEAD")
    return sorted(set(loose))


def schema_visible_admin_routes(app: FastAPI) -> list[str]:
    """Admin endpoints that would appear in ``/openapi.json``, as ``"METHOD /path"``.

    The published spec is not under ``/v1``, so the app's front door never sees a request for it
    and off prod it answers 200 to anybody. An admin path listed there hands a stranger the
    operator API map — every route, every method, every request and response schema — which is the
    same disclosure the console bundle is kept separate to prevent, for the price of one curl.
    """
    seen: list[str] = []
    for path, route, _ in iter_api_routes(app):
        if not path.startswith(ADMIN_PREFIX):
            continue
        if not getattr(route, "include_in_schema", False):
            continue
        methods = sorted(getattr(route, "methods", None) or {"?"})
        seen.extend(f"{m} {path}" for m in methods if m != "HEAD")
    return sorted(set(seen))


#: The one admin endpoint that cannot be behind the console-session guard: the login is what
#: ISSUES that session. It carries its own register check, its own second-factor check and its own
#: strict limiter. Adding to this tuple is a security decision, not a formality.
UNGUARDED_BY_DESIGN: tuple[str, ...] = (f"POST {ADMIN_PREFIX}/session",)


def assert_admin_surface(app: FastAPI) -> None:
    """Refuse to boot with an admin route that is unguarded or published. Called by ``create_app``.

    ``test_admin_guard.py`` already walks the built app and fails on either fault, and a test is a
    thing somebody can skip, mark xfail or never run on the box that deploys. This is the same two
    checks at start-up, where the consequence is a gateway that will not serve rather than a
    console that quietly serves the wrong person. It costs one walk of the route tree, once.
    """
    loose = [r for r in unguarded_admin_routes(app) if r not in UNGUARDED_BY_DESIGN]
    if loose:
        raise RuntimeError(
            "admin routes mounted without the console guard: "
            + ", ".join(loose)
            + ". Hang them off admin_auth.admin_router(), which carries the guard, rather than on "
            "the app directly."
        )
    published = schema_visible_admin_routes(app)
    if published:
        raise RuntimeError(
            "admin routes would be published in /openapi.json: "
            + ", ".join(published)
            + ". The operator API map is not a public document; mount them on "
            "admin_auth.admin_router(), which sets include_in_schema=False."
        )


# --- opening and closing a session ---------------------------------------------------------------
@dataclass(frozen=True)
class OpenedSession:
    token: str
    session: AdminSession
    admin: Admin


def open_session(request: Request) -> OpenedSession:
    """The login. The FACTOR is already proved by the Supabase token; this is the REGISTER check.

    Nothing here mints a credential for somebody who was not already signed in to the product: a
    console session is only ever issued to a verified subject that has a row in ``ops.admins``.
    """
    now = datetime.now(UTC)
    ip = client_ip(request)
    ip_hash = ip_fingerprint(ip)
    ua = (request.headers.get("user-agent") or "")[:256] or None
    principal = _principal(request)
    subject = getattr(principal, "subject", None)

    # The login path gets the strict bucket, keyed BOTH ways: by the account being used and by
    # the machine using it. One stolen token cannot be retried all day, and one machine cannot
    # work through a list of them.
    if _over(f"login-sub:{subject or 'anon'}", _login_ceiling()) or _over(
        f"login-ip:{ip_hash}", _login_ceiling()
    ):
        raise _too_many()

    if principal is None or not subject or getattr(principal, "anonymous", False):
        raise _refuse_stranger(request, "no_identity", subject)

    store = get_store()
    try:
        admin = store.admin_by_subject(subject)
        if admin is None:
            # NOBODY IS IN THE REGISTER UNDER THIS ACCOUNT. Before refusing, one question: is there
            # an INVITATION waiting for the address this token proves? That is how a person the
            # owner added by email becomes a seat (migration 0029) — and it is the only way a row
            # ever acquires an account id, so it happens here, once, at a sign-in the door has
            # already verified rather than anywhere a client could reach.
            admin = _invitation_for(store, principal)
    except StoreUnavailable as exc:
        raise AdminDenied(
            "register_unavailable", "I could not check your access just now.", status=503
        ) from exc

    if admin is None or not (admin.active or admin.invited):
        raise _refuse_stranger(request, "not_registered", subject)

    aal = _claim_aal(principal)
    if mfa_enforced() and admin.mfa_required and aal != "aal2":
        _audit_denial(store, request, admin, "admin.session.denied.mfa", ip_hash, ua)
        raise AdminDenied(
            "mfa_required",
            "This console needs your second factor. Enrol it in your account, then sign in again.",
            status=401,
        )

    if admin.invited:
        # The factor is proved by the time we are here (in prod the check above refuses without
        # it), which is exactly what the law asks: "they set up a second factor before their first
        # sign-in". Binding is conditional on the row still having no account, so two people
        # racing one invitation cannot both take it.
        try:
            bound = store.bind_subject(admin.id, subject)
        except StoreUnavailable as exc:
            raise AdminDenied(
                "register_unavailable", "I could not open the console just now.", status=503
            ) from exc
        if bound is None:
            raise _refuse_stranger(request, "invitation_taken", subject)
        admin = bound
        try:
            record_audit(
                store,
                action="admin.invite.accepted",
                actor=admin,
                request=request,
                ip_hash=ip_hash,
                user_agent=ua,
                resource_type="admin",
                resource_id=admin.id,
                detail={"granted_by": admin.granted_by, "aal": aal or "unknown"},
            )
        except StoreUnavailable as exc:
            raise AdminDenied(
                "audit_unavailable", "I could not open the console just now.", status=503
            ) from exc

    token = secrets.token_urlsafe(32)
    expires = now + timedelta(seconds=session_ttl_s())
    # The sign-in itself counts as the first step-up: the token that opened this session was
    # minted moments ago and (in prod) carried aal2. Writes stay available for the reauth window
    # and then need proving again.
    try:
        session = store.create_session(
            admin_id=admin.id,
            token_hash=hash_token(token),
            expires_at=expires,
            reauth_at=now,
            ip_hash=ip_hash,
            user_agent=ua,
        )
        record_audit(
            store,
            action="admin.session.open",
            actor=admin,
            session_id=session.id,
            request=request,
            ip_hash=ip_hash,
            user_agent=ua,
            detail={"aal": aal or "unknown", "ttl_s": session_ttl_s()},
        )
    except StoreUnavailable as exc:
        raise AdminDenied(
            "audit_unavailable", "I could not open the console just now.", status=503
        ) from exc
    return OpenedSession(token=token, session=session, admin=admin)


def _token_issued_at(principal: Any) -> datetime | None:
    claims = getattr(principal, "claims", None) or {}
    issued = claims.get("iat")
    if not isinstance(issued, int | float):
        return None
    return datetime.fromtimestamp(float(issued), tz=UTC)


def step_up(ctx: AdminContext) -> AdminSession:
    """Prove it is still you, before changing a learner's data or their money.

    What is checked, and what that is worth: the access token on THIS request must carry ``aal2``
    (Supabase writes that only after a TOTP factor has been verified) and must have been minted
    inside :func:`reauth_token_max_age_s`. The console gets such a token by running
    ``supabase.auth.mfa.challengeAndVerify()`` immediately before calling here, so a stale tab
    cannot satisfy it and neither can the token the session was opened with an hour ago.
    """
    now = datetime.now(UTC)
    principal = _principal(ctx.request)
    store = get_store()
    if mfa_enforced() and ctx.admin.mfa_required and _claim_aal(principal) != "aal2":
        ctx.audit("admin.reauth.denied", decision="denied", detail={"reason": "aal"})
        raise AdminDenied("mfa_required", "Enter the code from your authenticator.", status=401)
    issued = _token_issued_at(principal)
    if issued is None or (now - issued).total_seconds() > reauth_token_max_age_s():
        ctx.audit("admin.reauth.denied", decision="denied", detail={"reason": "stale_token"})
        raise AdminDenied(
            "reauth_required",
            "Confirm it is you again — that sign-in is too old to authorise a change.",
            status=401,
        )
    try:
        session = store.mark_reauth(ctx.session.id, now)
    except StoreUnavailable as exc:
        raise AdminDenied("register_unavailable", "Nothing has changed.", status=503) from exc
    if session is None:
        raise AdminDenied("admin_session_expired", "Your console session has ended.", status=401)
    ctx.audit("admin.reauth", detail={"window_s": reauth_window_s()})
    return session


# --- the routes this module owns -----------------------------------------------------------------
_ROLE_WORDS = {
    VIEWER: ("You can see the console's figures and queues, change nothing, and identify nobody."),
    OPERATOR: "You can see everything, and act on a learner's case, plan or flag.",
    OWNER: "You can see everything, act, and change who else has access.",
}


def _identity_view(admin: Admin) -> dict[str, Any]:
    """The corner of the console's shell: an id, a name, and what this seat may see.

    THE ADDRESS IS NOT IN IT. A console shell needs a word to greet somebody by, not a mailbox, so
    only the local part goes out — "show the least that does the job". The full address stays in
    the register and in the audit trail, where a real investigation can reach it.
    """
    display = admin.email.split("@", 1)[0] if "@" in admin.email else admin.email
    return {
        "id": admin.id,
        "display": display,
        "scopes": sorted(permissions_for(admin.role)),
        # The EFFECTIVE set, never the role's theory: the law says the screen shows what a person
        # actually holds, and the shell is the first place that has to be true.
        "capabilities": sorted(admin.capabilities),
    }


def _admin_view(admin: Admin) -> dict[str, Any]:
    return {
        "id": admin.id,
        "email": admin.email,
        "role": admin.role,
        "status": admin.status,
        "mfa_required": admin.mfa_required,
        "permissions": sorted(permissions_for(admin.role)),
        # What they hold, and — separately — what was moved for them by hand. Both, because "the
        # screen always shows the effective set rather than the theory" and an owner deciding
        # whether to put something back has to see which half of it was their own doing.
        "capabilities": sorted(admin.capabilities),
        "granted": sorted(admin.grants),
        "revoked": sorted(admin.revokes),
        "granted_by": admin.granted_by,
    }


#: The guarded caller, as an annotation rather than a default value. ``Annotated`` is the point:
#: ``ctx: Guarded`` puts a function CALL in a default argument, which is
#: evaluated once at import and is a genuine footgun everywhere except FastAPI. This spelling says
#: the same thing to FastAPI and nothing surprising to a reader.
Guarded = Annotated[AdminContext, Depends(guard)]
CanRead = Annotated[AdminContext, Depends(requires(CONSOLE_READ))]
CanManage = Annotated[AdminContext, Depends(requires(ADMIN_MANAGE))]


def register_admin(app: FastAPI) -> None:
    """Mount the console's door. Every route below is guarded by the router that carries them."""

    # The login is the ONE admin path that cannot be behind the console-session guard, because it
    # is what issues the session. It is not on the admin router for that reason, and it carries its
    # own register check, its own MFA check and its own strict limiter (open_session). It is also
    # the reason `unguarded_admin_routes` is a test rather than a comment: this is the exception,
    # and the test proves it is the ONLY one.
    # ``include_in_schema=False`` for the same reason the router carries it: the login is the
    # one admin path mounted straight on the app, so it is the one that would otherwise still
    # appear in ``/openapi.json`` and name the door.
    @app.post(f"{ADMIN_PREFIX}/session", tags=["admin"], include_in_schema=False)
    def open_console_session(request: Request, response: Response) -> dict[str, Any]:
        """Exchange a verified, second-factored product sign-in for a short console session."""
        try:
            opened = open_session(request)
        except AdminDenied as denied:
            raise denied.http() from denied
        # Set on the cookie AND returned in the body: see SESSION_COOKIE for why both, and why
        # neither is a CSRF exposure. The cookie is HttpOnly (a script in the page cannot read it),
        # Secure off dev, SameSite=Strict, and scoped to the admin prefix so it is never attached
        # to a learner route.
        response.set_cookie(
            SESSION_COOKIE,
            opened.token,
            max_age=session_ttl_s(),
            httponly=True,
            secure=is_prod(),
            samesite="strict",
            path=ADMIN_PREFIX,
        )
        return {
            # Shown to the client exactly once; only its digest is stored. A console that can take
            # the header path should keep this in memory, never in localStorage, so a script
            # injected into any other tab has nothing to read.
            "session_token": opened.token,
            "expires_at": _iso(opened.session.expires_at),
            "admin": _admin_view(opened.admin),
            "identity": _identity_view(opened.admin),
            "line": _ROLE_WORDS.get(opened.admin.role, ""),
        }

    router = admin_router(tags=["admin"])

    def _who(ctx: AdminContext) -> dict[str, Any]:
        now = datetime.now(UTC)
        return {
            "admin": _admin_view(ctx.admin),
            "identity": _identity_view(ctx.admin),
            "session": {
                "expires_at": _iso(ctx.session.expires_at),
                "stepped_up": ctx.session.stepped_up(now, reauth_window_s()),
                "reauth_at": _iso(ctx.session.reauth_at),
            },
            "line": _ROLE_WORDS.get(ctx.admin.role, ""),
        }

    @router.get("/session")
    def read_console_session(ctx: Guarded) -> dict[str, Any]:
        """Who the SERVER says is looking. The console believes this and nothing it holds itself."""
        return _who(ctx)

    @router.delete("/session")
    def close_console_session(response: Response, ctx: Guarded) -> dict[str, Any]:
        """Close the console. The row is revoked, so the token is dead on the next request."""
        ctx.audit("admin.session.end")
        try:
            get_store().revoke_session(ctx.session.id, datetime.now(UTC), "signed out")
        except StoreUnavailable as exc:
            raise AdminDenied(
                "register_unavailable", "I could not close that just now.", status=503
            ).http() from exc
        response.delete_cookie(SESSION_COOKIE, path=ADMIN_PREFIX)
        return {"ended": True}

    @router.get("/whoami")
    def whoami(ctx: Guarded) -> dict[str, Any]:
        """Alias of ``GET /session``, kept because it is the name an operator reaches for."""
        return _who(ctx)

    @router.post("/session/reauth")
    def reauth(ctx: Guarded) -> dict[str, Any]:
        """Step up. Send this with a token minted by a fresh authenticator challenge."""
        try:
            session = step_up(ctx)
        except AdminDenied as denied:
            raise denied.http() from denied
        return {
            "stepped_up": True,
            "reauth_at": _iso(session.reauth_at),
            "window_s": reauth_window_s(),
        }

    @router.get("/audit")
    def read_audit(
        request: Request,
        ctx: CanRead,
        limit: int = 100,
    ) -> dict[str, Any]:
        """The trail, newest first. No admin can change it, and only an owner reads all of it.

        Reading the trail is itself audited — including reading your own, which is the point:
        there is no view of this console that leaves no mark.

        WHO SEES WHOSE ROWS. A row names the actor's full address, their subject id, their session,
        their address fingerprint and every path they opened. Read across everybody, that is a
        complete surveillance record of the owner's working day handed to the lowest seat in the
        register — while ``_identity_view`` two hundred lines up goes to deliberate trouble to
        strip the domain off an admin's own address, on the grounds that a shell needs a word to
        greet somebody by and not a mailbox. Both cannot be the rule. So:

        * ``admin.manage`` (owner) reads the whole trail, and may filter it by actor. Somebody has
          to be able to answer "who looked at this child's record", and that somebody is the person
          who can also revoke the seat that did it.
        * every other seat reads THEIR OWN rows, whatever they ask for. That is the transparency
          half of the original rule — you can always see what was written down about you — with the
          surveillance half removed.

        ``scope`` says which of the two happened, so the console never presents a filtered trail as
        if it were the whole one.
        """
        asked = (request.query_params.get("actor") or "").strip() or None
        # Two locks on the whole trail, and they are different questions: ``admin.manage`` is the
        # owner's level, and the register PANEL is the capability an owner can move per person.
        # Reading everybody's day is the register's own panel, so a seat that does not hold it
        # reads its own rows however it asks.
        may_read_all = ctx.admin.may(ADMIN_MANAGE) and ctx.admin.may_panel(
            console_panels.panel("register").read
        )
        actor = asked if may_read_all else ctx.admin.subject_id
        if actor and not _UUID_RE.match(actor):
            # A typo is not an outage. 400 here, and the operator is told which of the two it is.
            raise AdminDenied(
                "not_an_id",
                "That is not an account id, so there is nothing to filter the trail by.",
                status=400,
            ).http()
        ctx.audit(
            "admin.audit.read",
            detail={
                "limit": limit,
                "filtered": bool(actor),
                "scope": "all" if may_read_all and not actor else ("actor" if actor else "all"),
            },
        )
        try:
            rows = get_store().list_audit(limit=max(1, min(limit, 500)), actor_subject=actor)
        except BadIdentifier as exc:
            raise AdminDenied(
                "not_an_id",
                "That is not an account id, so there is nothing to filter the trail by.",
                status=400,
            ).http() from exc
        except StoreUnavailable as exc:
            raise AdminDenied(
                "register_unavailable", "I could not read the trail just now.", status=503
            ).http() from exc
        return {
            "rows": rows,
            "count": len(rows),
            "append_only": True,
            # "everybody's" or "only yours". The console prints this beside the table: a trail that
            # is one person's, shown as though it were the whole register's, is its own small lie.
            "scope": "everyone" if may_read_all else "self",
            "actor": actor,
        }

    @router.get("/panels")
    def panels(ctx: Guarded) -> dict[str, Any]:
        """What this seat may see, and where it may also act.

        ONLY THE PANELS THEY HOLD ARE IN THE ANSWER. "A panel they cannot read is not greyed out,
        it is not there" — a console cannot grey out what it was never sent, and a rail built from
        this list cannot accidentally advertise a desk. The refusal at the route is the other half
        (:func:`_require_panel`); this is the half that means nobody has to meet it.
        """
        held = ctx.admin.capabilities
        return {
            "panels": console_panels.view(held),
            "capabilities": sorted(held),
            "role": ctx.admin.role,
        }

    @router.get("/admins")
    def list_admins(ctx: CanManage) -> dict[str, Any]:
        """Who has access, what each holds, and everything that is grantable.

        Owner only: a viewer does not need the list of people to target. The vocabulary rides with
        it because the screen that changes a capability must offer the real list rather than one
        typed into a browser bundle that could drift from the guard's.
        """
        ctx.audit("admin.register.read")
        store = get_store()
        try:
            rows = store.list_admins()
            owners = store.count_active_owners()
        except StoreUnavailable as exc:
            raise AdminDenied(
                "register_unavailable", "I could not read the register just now.", status=503
            ).http() from exc
        return {
            "admins": [_admin_view(a) for a in rows],
            "roles": list(ROLES),
            "vocabulary": console_panels.vocabulary(),
            "defaults": {role: sorted(console_panels.defaults_for(role)) for role in ROLES},
            "owner_count": owners,
        }

    def _capability_changes(raw: Any) -> list[tuple[str, str]]:
        """Read a list of ``{capability, effect}`` from a body, refusing anything unknown.

        Checked against the vocabulary rather than against a shape: a grant of something nobody
        implemented is a row that will be misread by whoever finds it later.
        """
        changes: list[tuple[str, str]] = []
        if raw in (None, ""):
            return changes
        if not isinstance(raw, list):
            raise AdminDenied("not_a_capability", "Capabilities come as a list.", status=400).http()
        for entry in raw[:64]:
            if not isinstance(entry, dict):
                raise AdminDenied(
                    "not_a_capability", "Each capability is an object.", status=400
                ).http()
            name = str(entry.get("capability") or "").strip()
            effect = str(entry.get("effect") or "grant").strip()
            if name not in console_panels.CAPABILITIES or effect not in {
                "grant",
                "revoke",
                "default",
            }:
                raise AdminDenied(
                    "not_a_capability",
                    f"{name!r} with {effect!r} is not something this console can grant.",
                    status=400,
                ).http()
            changes.append((name, effect))
        return changes

    @router.post("/admins")
    def grant_admin(body: dict[str, Any], ctx: CanManage) -> dict[str, Any]:
        """Add somebody. The owner's action alone, stepped up, and always audited.

        "An email, a starting role, the capabilities; they receive an invitation, set up a second
        factor before their first sign-in, and appear in the register with who granted them."

        So the ADDRESS is what is required and the account id is not: a person the owner wants to
        add has usually never signed in, and asking an owner to go and find a uuid in the Supabase
        dashboard is how a register ends up with the wrong person in it. The row is created
        ``invited``, which opens nothing, and binds to whichever account proves that address at
        its first sign-in — where the factor is demanded by the door that already exists.

        THE OWNER IS NEVER GRANTED HERE. One account holds that seat (migration 0029 makes it a
        constraint), and the way it ever moves is the break-glass in docs/OPERATIONS.md, which
        needs a direct SQL connection and nobody's cooperation but the owner's.
        """
        subject = str(body.get("subject_id") or "").strip()
        email = str(body.get("email") or "").strip()
        role = str(body.get("role") or VIEWER).strip()
        changes = _capability_changes(body.get("capabilities"))
        if role == OWNER:
            ctx.audit(
                "admin.denied.owner",
                decision="denied",
                resource_type="admin",
                detail={"reason": "second_owner"},
            )
            raise AdminDenied(
                "one_owner",
                "There is one owner account and it cannot be granted from here. "
                "Moving it is the break-glass in docs/OPERATIONS.md.",
                status=400,
            ).http()
        if role not in ROLES or "@" not in email or len(email) > 320:
            raise AdminDenied(
                "not_a_grant",
                "I need the person's address and one of: " + ", ".join(ROLES) + ".",
                status=400,
            ).http()
        if subject and not _UUID_RE.match(subject):
            raise AdminDenied(
                "not_an_id", "That is not an account id, so nobody was added.", status=400
            ).http()
        store = get_store()
        try:
            admin = store.upsert_admin(
                subject_id=subject or None,
                email=email,
                role=role,
                granted_by=ctx.admin.id,
                # Never granted without a second factor. Their first sign-in is refused until
                # they enrol one, which is the correct order.
                mfa_required=True,
                status="active" if subject else "invited",
            )
            for name, effect in changes:
                store.set_capability(
                    admin_id=admin.id,
                    capability=name,
                    effect=effect,
                    granted_by=ctx.admin.id,
                )
            if changes:
                admin = store.admin_by_id(admin.id) or admin
        except BadIdentifier as exc:
            raise AdminDenied(
                "not_an_id", "That is not an id, so nobody was added.", status=400
            ).http() from exc
        except StoreUnavailable as exc:
            raise AdminDenied(
                "register_unavailable", "Nothing has changed.", status=503
            ).http() from exc
        ctx.audit(
            "admin.invite" if admin.invited else "admin.grant",
            resource_type="admin",
            resource_id=admin.id,
            detail={
                "role": role,
                "status": admin.status,
                "capabilities": [{"capability": n, "effect": e} for n, e in changes],
            },
        )
        return {"admin": _admin_view(admin), "granted": True}

    @router.post("/admins/{admin_id}/capabilities")
    def set_capability(admin_id: str, body: dict[str, Any], ctx: CanManage) -> dict[str, Any]:
        """Grant or revoke ONE capability for ONE person, with a row to show for it.

        Three effects and not two: ``grant`` adds it to whatever the role starts with, ``revoke``
        takes it away, and ``default`` deletes the row so the person follows their role again. A
        console that could only grant and revoke would turn every role into a frozen copy of
        itself the first time anybody touched it.
        """
        changes = _capability_changes(
            [{"capability": body.get("capability"), "effect": body.get("effect") or "grant"}]
        )
        name, effect = changes[0]
        store = get_store()
        try:
            target = store.admin_by_id(admin_id)
        except BadIdentifier as exc:
            raise AdminDenied(
                "not_an_id", "That is not an admin id, so nothing was changed.", status=400
            ).http() from exc
        except StoreUnavailable as exc:
            raise AdminDenied(
                "register_unavailable", "Nothing has changed.", status=503
            ).http() from exc
        if target is None:
            raise AdminDenied(
                "no_such_admin", "There is no such person in the register.", status=404
            ).http()
        if target.role == OWNER:
            # The owner's seat is not hollowed out one capability at a time — including by the
            # owner, whose mistake here would need the break-glass to undo.
            ctx.audit(
                "admin.denied.owner",
                decision="denied",
                resource_type="admin",
                resource_id=target.id,
                detail={"capability": name, "effect": effect},
            )
            raise AdminDenied(
                "not_the_owners",
                "The owner holds every panel and that cannot be changed from here.",
                status=400,
            ).http()
        before = sorted(target.capabilities)
        try:
            store.set_capability(
                admin_id=target.id,
                capability=name,
                effect=effect,
                granted_by=ctx.admin.id,
                note=str(body.get("note") or "")[:500] or None,
            )
            updated = store.admin_by_id(target.id) or target
        except StoreUnavailable as exc:
            raise AdminDenied(
                "register_unavailable", "Nothing has changed.", status=503
            ).http() from exc
        ctx.audit(
            "admin.capability",
            resource_type="admin",
            resource_id=target.id,
            # What the value was before, which is what the law asks the trail to carry.
            detail={
                "capability": name,
                "effect": effect,
                "before": before,
                "after": sorted(updated.capabilities),
            },
        )
        return {"admin": _admin_view(updated), "changed": True}

    @router.post("/admins/{admin_id}/suspend")
    def suspend_admin(admin_id: str, ctx: CanManage) -> dict[str, Any]:
        """Take access away. "Suspending is instant and ends their sessions."

        Instant is the word that does the work. Marking the row alone would leave every console
        session they hold live until its own clock ran out, so the sessions are revoked in the
        same breath and their next request — on the token already in their browser — is refused.

        The row itself stays, suspended, so their trail keeps a name beside it.
        """
        if admin_id == ctx.admin.id:
            # Not a safety rail for its own sake: an owner who suspends themselves locks the last
            # door in the building, and there is no way back in except the break-glass.
            raise AdminDenied(
                "not_yourself",
                "You cannot suspend your own access. Ask another owner to do it.",
                status=400,
            ).http()
        store = get_store()
        try:
            target = store.admin_by_id(admin_id)
        except BadIdentifier as exc:
            # "That is not an id" and "the register is unreachable" are different facts, and an
            # owner mid-incident needs to know which one they are looking at.
            raise AdminDenied(
                "not_an_id", "That is not an admin id, so nothing was changed.", status=400
            ).http() from exc
        except StoreUnavailable as exc:
            raise AdminDenied(
                "register_unavailable", "Nothing has changed.", status=503
            ).http() from exc
        if target is None:
            raise AdminDenied(
                "no_such_admin", "There is no such person in the register.", status=404
            ).http()
        if target.role == OWNER:
            ctx.audit(
                "admin.denied.owner",
                decision="denied",
                resource_type="admin",
                resource_id=target.id,
                detail={"reason": "suspend"},
            )
            raise AdminDenied(
                "not_the_owners",
                "The owner's access cannot be taken away from here.",
                status=400,
            ).http()
        try:
            admin = store.set_admin_status(target.id, "suspended")
            ended = store.revoke_sessions_for_admin(
                target.id, datetime.now(UTC), "access suspended"
            )
        except StoreUnavailable as exc:
            raise AdminDenied(
                "register_unavailable", "Nothing has changed.", status=503
            ).http() from exc
        if admin is None:
            raise AdminDenied(
                "no_such_admin", "There is no such person in the register.", status=404
            ).http()
        ctx.audit(
            "admin.suspend",
            resource_type="admin",
            resource_id=admin.id,
            detail={"sessions_ended": ended},
        )
        return {"admin": _admin_view(admin), "suspended": True, "sessions_ended": ended}

    app.include_router(router)


__all__ = [
    "ADMIN_MANAGE",
    "ADMIN_PREFIX",
    "BadIdentifier",
    "CONSOLE_READ",
    "LEARNER_ACT",
    "LEARNER_READ",
    "OPERATOR",
    "OWNER",
    "PERMISSIONS",
    "ROLES",
    "SESSION_COOKIE",
    "SESSION_HEADER",
    "SUPPORT_ACT",
    "VIEWER",
    "WRITE_PERMISSIONS",
    "Admin",
    "AdminContext",
    "AdminDenied",
    "AdminSession",
    "AdminStore",
    "InMemoryAdminStore",
    "PostgrestAdminStore",
    "StoreUnavailable",
    "UnconfiguredAdminStore",
    "admin_router",
    "build_store",
    "get_store",
    "guard",
    "iter_api_routes",
    "hash_token",
    "mfa_enforced",
    "open_session",
    "permissions_for",
    "reauth_window_s",
    "record_audit",
    "register_admin",
    "requires",
    "reset_limiter",
    "resolve_context",
    "session_token",
    "session_ttl_s",
    "set_store",
    "step_up",
    "unguarded_admin_routes",
    "validate_admin_env",
]
