"""Read-only proxy into nesso for UI affordances (device picker, etc).

Distinct from the import flow (`/api/datasets/import_nesso`) and the
sync flow (`/api/recordings/:id/sync_nesso_labels`) so the namespace
clearly separates "things label-app stores" from "things label-app
reads from nesso to populate UI".
"""
from __future__ import annotations

import logging

from flask import Blueprint, jsonify

from ..services import nesso_events

bp = Blueprint("nesso", __name__, url_prefix="/api/nesso")
log = logging.getLogger(__name__)


@bp.route("/devices", methods=["GET"])
def list_nesso_devices():
    try:
        return jsonify(nesso_events.list_devices())
    except Exception as e:
        log.warning("nesso devices list failed: %s", e)
        return jsonify({"error": f"nesso devices fetch failed: {e}"}), 502
