from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path

from version_matrix import SEMVER, VersionMatrixError, load_version_matrix, main


class VersionMatrixTests(unittest.TestCase):
    def _fixture(self, root: Path, version: str = "0.1.0") -> None:
        (root / "frontend").mkdir()
        (root / "backend").mkdir()
        (root / "agent-runtime").mkdir()
        (root / "science-core").mkdir()
        (root / "VERSION").write_text(f"{version}\n", encoding="utf-8")
        package = json.dumps({"version": version})
        (root / "frontend/package.json").write_text(package, encoding="utf-8")
        (root / "agent-runtime/package.json").write_text(package, encoding="utf-8")
        package_lock = json.dumps({"version": version, "packages": {"": {"version": version}}})
        (root / "frontend/package-lock.json").write_text(package_lock, encoding="utf-8")
        (root / "agent-runtime/package-lock.json").write_text(package_lock, encoding="utf-8")
        pyproject = f'[project]\nname = "fixture"\nversion = "{version}"\n'
        (root / "backend/pyproject.toml").write_text(pyproject, encoding="utf-8")
        (root / "science-core/pyproject.toml").write_text(pyproject, encoding="utf-8")
        (root / "backend/uv.lock").write_text(
            f'[[package]]\nname = "glaux-backend"\nversion = "{version}"\n', encoding="utf-8"
        )
        (root / "science-core/uv.lock").write_text(
            f'[[package]]\nname = "glaux-core"\nversion = "{version}"\n', encoding="utf-8"
        )

    def test_repository_matrix_has_all_scopes_and_valid_versions(self) -> None:
        root = Path(__file__).resolve().parents[1]
        matrix = load_version_matrix(root)
        self.assertEqual(
            set(matrix), {"product", "frontend", "backend", "agent-runtime", "science-core"}
        )
        self.assertTrue(all(SEMVER.fullmatch(version) for version in matrix.values()))

    def test_accepts_semver_prerelease_and_build_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._fixture(root, "1.2.3-rc.1+build.7")
            self.assertEqual(set(load_version_matrix(root).values()), {"1.2.3-rc.1+build.7"})

    def test_rejects_invalid_semver_with_scope_and_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._fixture(root)
            (root / "frontend/package.json").write_text('{"version":"v0.1"}', encoding="utf-8")
            with self.assertRaisesRegex(VersionMatrixError, r"frontend: invalid SemVer.*package.json"):
                load_version_matrix(root)

    def test_missing_version_field_returns_nonzero(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._fixture(root)
            (root / "backend/pyproject.toml").write_text('[project]\nname="fixture"\n', encoding="utf-8")
            with redirect_stderr(io.StringIO()):
                self.assertEqual(main(["--check", "--root", str(root)]), 1)

    def test_rejects_generated_lock_version_drift(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._fixture(root)
            lock = {"version": "0.1.1", "packages": {"": {"version": "0.1.1"}}}
            (root / "frontend/package-lock.json").write_text(json.dumps(lock), encoding="utf-8")
            with self.assertRaisesRegex(
                VersionMatrixError, r"frontend: generated lock version.*does not match"
            ):
                load_version_matrix(root)


if __name__ == "__main__":
    unittest.main()
