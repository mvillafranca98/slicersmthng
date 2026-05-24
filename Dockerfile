# SlicerSmthng — single-image production build.
# Stage 1: build the React frontend.
FROM node:20-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python runtime + Flask + pre-built frontend.
FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    SLICERSMTHNG_STORAGE=/tmp/slicersmthng \
    PORT=8080

# ffmpeg is required by yt-dlp for audio extraction.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
# Install pinned deps, then upgrade yt-dlp to the very latest so we get the
# newest YouTube anti-bot workarounds without rebuilding the requirements pin.
RUN pip install -r requirements.txt && pip install -U yt-dlp

# Copy backend source.
COPY server.py ./
COPY backend/ ./backend/

# Bring in the built frontend so Flask can serve it from /.
COPY --from=frontend /app/frontend/dist ./frontend/dist

EXPOSE 8080
CMD ["python", "server.py"]
