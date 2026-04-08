import sqlite3
from pathlib import Path
from . import config

SCHEMA_VERSION = 1

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now')),
    description TEXT
);

CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    display_name TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS datasets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    source_format TEXT NOT NULL,
    source_path TEXT,
    sample_rate_hz REAL NOT NULL,
    channel_count INTEGER NOT NULL,
    channel_names TEXT NOT NULL,
    channel_units TEXT,
    content_hash TEXT UNIQUE,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recordings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    participant_id INTEGER REFERENCES participants(id),
    name TEXT NOT NULL,
    data_path TEXT NOT NULL,
    sample_count INTEGER NOT NULL,
    start_ns INTEGER NOT NULL,
    end_ns INTEGER NOT NULL,
    duration_seconds REAL GENERATED ALWAYS AS ((end_ns - start_ns) / 1e9) STORED,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(dataset_id, name)
);

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    label_schema TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_recordings (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    recording_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, recording_id)
);

CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recording_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label_name TEXT NOT NULL,
    start_ns INTEGER NOT NULL,
    end_ns INTEGER NOT NULL,
    confidence REAL,
    source TEXT DEFAULT 'manual',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_annotations_recording ON annotations(recording_id, project_id);
CREATE INDEX IF NOT EXISTS idx_annotations_label ON annotations(label_name);
CREATE INDEX IF NOT EXISTS idx_recordings_dataset ON recordings(dataset_id);

CREATE TABLE IF NOT EXISTS models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    py_path TEXT NOT NULL,
    weights_path TEXT NOT NULL,
    class_name TEXT NOT NULL,
    settings TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recording_lineage (
    child_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    parent_id INTEGER NOT NULL REFERENCES recordings(id),
    start_offset INTEGER,
    end_offset INTEGER,
    PRIMARY KEY (child_id)
);
"""


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(config.DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_connection()
    try:
        conn.executescript(SCHEMA_SQL)
        # Check if version exists
        cur = conn.execute("SELECT MAX(version) FROM schema_version")
        row = cur.fetchone()
        if row[0] is None:
            conn.execute(
                "INSERT INTO schema_version (version, description) VALUES (?, ?)",
                (SCHEMA_VERSION, "Initial schema"),
            )
        conn.commit()
    finally:
        conn.close()
