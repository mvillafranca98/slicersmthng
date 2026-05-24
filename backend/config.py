"""SlicerSmthng backend configuration."""
from pathlib import Path

# Storage: PRD specifies ~/Music/SlicerSmthng
BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_STORAGE = Path.home() / "Music" / "SlicerSmthng"
STORAGE_DIR = Path(__file__).resolve().parent.parent  # allow override via env

def get_storage():
    import os
    return Path(os.environ.get("SLICERSMTHNG_STORAGE", str(DEFAULT_STORAGE)))
