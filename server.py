"""
SlicerSmthng — Flask backend + optional static SPA serve.
Run: python server.py
API: /api/v1/*
WebSocket: SocketIO for job progress
"""
from pathlib import Path
from flask import Flask, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO

from backend.routes import api, set_socketio

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024
CORS(app, origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000", "http://127.0.0.1:3000"])
socketio = SocketIO(app, cors_allowed_origins="*")
set_socketio(socketio)
app.register_blueprint(api)

# Serve React build when present
FRONTEND_DIST = Path(__file__).resolve().parent / "frontend" / "dist"

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_spa(path):
    if FRONTEND_DIST.exists():
        if path and (FRONTEND_DIST / path).exists() and (FRONTEND_DIST / path).is_file():
            return send_from_directory(FRONTEND_DIST, path)
        return send_from_directory(FRONTEND_DIST, "index.html")
    return (
        "<!DOCTYPE html><html><body><h1>SlicerSmthng</h1>"
        "<p>Frontend not built. Run: <code>cd frontend && npm run build</code></p>"
        "<p>Or run dev: <code>cd frontend && npm run dev</code> and open http://localhost:5173</p>"
        "</body></html>",
        200,
        {"Content-Type": "text/html"},
    )

if __name__ == "__main__":
    import os
    import socket

    # Render (and most PaaS) inject the port to bind via $PORT.
    port_env = os.environ.get("PORT")
    if port_env:
        port = int(port_env)
    else:
        # Local dev: find a free port starting at 8080.
        def free_port(start=8080, n=10):
            for p in range(start, start + n):
                try:
                    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    s.bind(("", p))
                    s.close()
                    return p
                except OSError:
                    continue
            return 8080
        port = free_port()

    # Disable Flask debug + reloader when running on a host (Render sets RENDER=true).
    is_prod = bool(os.environ.get("RENDER") or os.environ.get("PORT"))
    debug = not is_prod

    if debug:
        print(f"SlicerSmthng API: http://localhost:{port}")
        print(f"API base: http://localhost:{port}/api/v1")

    socketio.run(app, host="0.0.0.0", port=port, debug=debug, allow_unsafe_werkzeug=is_prod)
