# SlicerSmthng — single-image production build.
# Stage 1: build the React frontend. Node 22 because the runtime stage also
# reuses this binary for yt-dlp, which needs Node 22+.
FROM node:22-bookworm-slim AS frontend
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

# yt-dlp runs YouTube's player challenges through Node (see _yt_dlp_opts in
# backend/jobs.py). Without a JS runtime it can't resolve most audio formats.
COPY --from=frontend /usr/local/bin/node /usr/local/bin/node
RUN node --version

WORKDIR /app
COPY requirements.txt ./
# Install pinned deps, then upgrade yt-dlp to the very latest so we get the
# newest YouTube fixes without rebuilding the requirements pin. The [default]
# extra brings the matching yt-dlp-ejs (challenge-solver scripts Node runs).
RUN pip install -r requirements.txt && pip install -U "yt-dlp[default]"

# Copy backend source.
COPY server.py ./
COPY backend/ ./backend/

# Bring in the built frontend so Flask can serve it from /.
COPY --from=frontend /app/frontend/dist ./frontend/dist

EXPOSE 8080
CMD ["python", "server.py"]
