import os
from pathlib import Path

from flask import Flask, send_from_directory
from flask_cors import CORS
from . import database


def create_app():
    # Optional bundled SPA: when STATIC_DIR is set (production container),
    # Flask serves the React build at `/` and falls through to
    # index.html for any non-/api path (client-side routing).
    static_dir = os.getenv("STATIC_DIR")
    if static_dir and Path(static_dir).is_dir():
        app = Flask(__name__, static_folder=static_dir, static_url_path="")
    else:
        app = Flask(__name__)
    CORS(app)

    database.init_db()

    from .routes import datasets, recordings, projects, annotations, models, exports
    app.register_blueprint(datasets.bp)
    app.register_blueprint(recordings.bp)
    app.register_blueprint(projects.bp)
    app.register_blueprint(annotations.bp)
    app.register_blueprint(models.bp)
    app.register_blueprint(exports.bp)

    @app.route('/api/health')
    def health():
        return {'status': 'ok'}

    if static_dir and Path(static_dir).is_dir():
        @app.route("/", defaults={"path": ""})
        @app.route("/<path:path>")
        def spa(path):
            full = Path(static_dir) / path
            if path and full.is_file():
                return send_from_directory(static_dir, path)
            return send_from_directory(static_dir, "index.html")

    return app
