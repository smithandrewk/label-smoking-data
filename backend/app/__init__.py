from flask import Flask
from flask_cors import CORS
from . import database


def create_app():
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

    return app
