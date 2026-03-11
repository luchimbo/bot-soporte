from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = ROOT / "kommo-widget"
DIST_DIR = ROOT / "dist"
ZIP_PATH = DIST_DIR / "kommo-widget.zip"
ENV_PATH = ROOT / ".env"
MANIFEST_PATH = SOURCE_DIR / "manifest.json"

INCLUDE_FILES = [
  "manifest.json",
  "script.js",
    "i18n/es.json",
    "i18n/en.json",
    "images/logo_min.png",
    "images/logo_medium.png",
    "images/logo_main.png",
    "images/logo.png",
    "images/logo_small.png",
    "images/logo_dp.png",
]


def load_dotenv(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}

    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()

        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"\"", "'"}:
            value = value[1:-1]

        values[key] = value

    return values


def get_config_value(name: str, dotenv_values: dict[str, str]) -> str:
    raw = os.environ.get(name)
    if raw is not None and raw.strip():
        return raw.strip()
    return dotenv_values.get(name, "").strip()


def build_manifest(dotenv_values: dict[str, str]) -> tuple[bytes, str, str]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    default_backend_url = get_config_value("KOMMO_WIDGET_DEFAULT_BACKEND_URL", dotenv_values)
    support_email = get_config_value("KOMMO_WIDGET_SUPPORT_EMAIL", dotenv_values)

    if default_backend_url:
        manifest["settings"]["default_backend_url"]["default_value"] = default_backend_url
        manifest["salesbot_designer"]["support_request"]["settings"]["endpoint_url"][
            "default_value"
        ] = default_backend_url

    if support_email:
        manifest["widget"]["support"]["email"] = support_email

    manifest_bytes = json.dumps(manifest, indent=2, ensure_ascii=True).encode("utf-8") + b"\n"
    effective_email = str(manifest["widget"]["support"]["email"])
    effective_url = str(manifest["settings"]["default_backend_url"]["default_value"])
    return manifest_bytes, effective_email, effective_url


def main() -> int:
    if not SOURCE_DIR.exists():
        print(f"No existe la carpeta del widget: {SOURCE_DIR}", file=sys.stderr)
        return 1

    DIST_DIR.mkdir(parents=True, exist_ok=True)
    if ZIP_PATH.exists():
        ZIP_PATH.unlink()

    dotenv_values = load_dotenv(ENV_PATH)
    manifest_bytes, effective_email, effective_url = build_manifest(dotenv_values)

    with ZipFile(ZIP_PATH, "w", compression=ZIP_DEFLATED) as zf:
        for rel_path in INCLUDE_FILES:
            if rel_path == "manifest.json":
                zf.writestr(rel_path, manifest_bytes)
                continue

            source_path = SOURCE_DIR / rel_path
            if not source_path.exists():
                print(f"Falta archivo requerido: {source_path}", file=sys.stderr)
                return 1
            zf.write(source_path, arcname=rel_path.replace("\\", "/"))

    print(f"Widget empaquetado en: {ZIP_PATH}")
    print(f"Support email: {effective_email}")
    print(f"Default backend URL: {effective_url or '(vacio)'}")
    print("Contenido:")
    with ZipFile(ZIP_PATH, "r") as zf:
        for name in zf.namelist():
            print(f"- {name}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
