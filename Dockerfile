# Multi-stage build: React frontend + Flask backend in one image.
# Phase-1 deployment shape — frontend served as static files from Flask
# so we don't need a separate nginx container or a CORS dance.

# ---------- frontend build ----------
FROM node:20-alpine AS frontend

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build
# Output lives at /build/dist


# ---------- backend runtime ----------
FROM python:3.12-slim AS runtime

WORKDIR /app

# Build deps for psycopg + pyarrow wheel resolution
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir gunicorn

COPY backend/ ./backend/
COPY --from=frontend /build/dist/ ./frontend-dist/

ENV STATIC_DIR=/app/frontend-dist \
    DATA_ROOT=/var/lib/label/data \
    DB_PATH=/var/lib/label/label-tool.db \
    MODEL_DIR=/var/lib/label/models \
    PYTHONUNBUFFERED=1

EXPOSE 5001

WORKDIR /app/backend
# 2 workers, modest timeout — heavy import jobs are async-ish via parquet
# write but we leave headroom for a large CSV scan.
CMD ["gunicorn", "-w", "2", "-t", "120", "-b", "0.0.0.0:5001", "run:app"]
