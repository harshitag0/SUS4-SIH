import os
import tempfile

# Must be set before the app is imported: tests never touch the demo database.
os.environ["M2_DB_NAME"] = "agrilink_m2_test"
os.environ["M2_UPLOAD_DIR"] = tempfile.mkdtemp(prefix="m2-uploads-")
os.environ["M2_ALLOW_DEMO_CONTROLS"] = "true"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import PHOTO, seed  # noqa: E402


@pytest.fixture()
def db():
    d = get_db()
    seed(d)
    yield d


@pytest.fixture()
def client(db):
    with TestClient(app) as c:
        yield c


def as_(role, actor=None):
    h = {"X-M2-Role": role}
    if actor:
        h["X-M2-Actor"] = actor
    return h


OPS = as_("admin", "OPS-1")
SYSTEM = as_("system", "MODULE1")
GOOD_PNG = PHOTO["good"]
