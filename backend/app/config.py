import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent.parent / '.env')

BASE_DIR = Path(__file__).resolve().parent.parent.parent

DATA_ROOT = Path(os.getenv('DATA_ROOT', './data')).resolve()
DB_PATH = Path(os.getenv('DB_PATH', './label-tool.db')).resolve()
MODEL_DIR = Path(os.getenv('MODEL_DIR', './data/models')).resolve()
RECORDINGS_DIR = DATA_ROOT / 'recordings'

# Ensure directories exist
DATA_ROOT.mkdir(parents=True, exist_ok=True)
RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
MODEL_DIR.mkdir(parents=True, exist_ok=True)
