#!/usr/bin/env python3
"""读取并校验 Glaux 整体与组件版本事实源。"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tomllib
from collections.abc import Callable
from pathlib import Path

SEMVER = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)"
    r"(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?"
    r"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$"
)
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


class VersionMatrixError(ValueError):
    """版本事实源缺失或不合法。"""


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def _read_json_version(path: Path) -> str:
    data = json.loads(path.read_text(encoding="utf-8"))
    value = data.get("version")
    if not isinstance(value, str):
        raise ValueError("missing string field 'version'")
    return value


def _read_pyproject_version(path: Path) -> str:
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    project = data.get("project")
    if not isinstance(project, dict) or not isinstance(project.get("version"), str):
        raise ValueError("missing string field 'project.version'")
    return project["version"]


def _read_package_lock_version(path: Path) -> str:
    data = json.loads(path.read_text(encoding="utf-8"))
    root_version = data.get("version")
    packages = data.get("packages")
    root_package = packages.get("") if isinstance(packages, dict) else None
    package_version = root_package.get("version") if isinstance(root_package, dict) else None
    if not isinstance(root_version, str) or not isinstance(package_version, str):
        raise ValueError("missing generated root package version")
    if root_version != package_version:
        raise ValueError(
            f"generated package versions disagree: {root_version!r} != {package_version!r}"
        )
    return root_version


def _read_uv_lock_version(path: Path, package_name: str) -> str:
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    packages = data.get("package")
    if not isinstance(packages, list):
        raise ValueError("missing package list")
    versions = [
        item.get("version")
        for item in packages
        if isinstance(item, dict) and item.get("name") == package_name
    ]
    if len(versions) != 1 or not isinstance(versions[0], str):
        raise ValueError(f"expected one generated version for {package_name!r}")
    return versions[0]


def _read_version(scope: str, path: Path, reader: Callable[[Path], str]) -> str:
    try:
        version = reader(path)
    except (OSError, ValueError) as error:
        raise VersionMatrixError(f"{scope}: cannot read {path}: {error}") from error
    if not SEMVER.fullmatch(version):
        raise VersionMatrixError(f"{scope}: invalid SemVer {version!r} in {path}")
    return version


def load_version_matrix(root: Path = REPOSITORY_ROOT) -> dict[str, str]:
    sources: tuple[tuple[str, Path, Callable[[Path], str]], ...] = (
        ("product", root / "VERSION", _read_text),
        ("frontend", root / "frontend/package.json", _read_json_version),
        ("backend", root / "backend/pyproject.toml", _read_pyproject_version),
        ("agent-runtime", root / "agent-runtime/package.json", _read_json_version),
        ("science-core", root / "science-core/pyproject.toml", _read_pyproject_version),
    )
    matrix = {scope: _read_version(scope, path, reader) for scope, path, reader in sources}
    replicas: tuple[tuple[str, Path, Callable[[Path], str]], ...] = (
        ("frontend", root / "frontend/package-lock.json", _read_package_lock_version),
        (
            "backend",
            root / "backend/uv.lock",
            lambda path: _read_uv_lock_version(path, "glaux-backend"),
        ),
        ("agent-runtime", root / "agent-runtime/package-lock.json", _read_package_lock_version),
        (
            "science-core",
            root / "science-core/uv.lock",
            lambda path: _read_uv_lock_version(path, "glaux-core"),
        ),
    )
    for scope, path, reader in replicas:
        replica = _read_version(f"{scope} lock", path, reader)
        if replica != matrix[scope]:
            raise VersionMatrixError(
                f"{scope}: generated lock version {replica!r} in {path} "
                f"does not match source version {matrix[scope]!r}"
            )
    return matrix


def format_version_matrix(matrix: dict[str, str]) -> str:
    width = max(len(scope) for scope in matrix)
    return "\n".join(f"{scope:<{width}}  {version}" for scope, version in matrix.items())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="只报告校验结果")
    parser.add_argument("--root", type=Path, default=REPOSITORY_ROOT, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    try:
        matrix = load_version_matrix(args.root.resolve())
    except VersionMatrixError as error:
        print(f"version-check: {error}", file=sys.stderr)
        return 1

    if args.check:
        print("version-check: ok")
    else:
        print(format_version_matrix(matrix))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
