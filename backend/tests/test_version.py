from importlib.metadata import version

import app


def test_backend_version_comes_from_distribution_metadata():
    assert app.__version__ == version("glaux-backend")


def test_backend_version_is_unknown_when_distribution_metadata_is_missing(monkeypatch):
    def missing(_distribution: str) -> str:
        raise app._metadata.PackageNotFoundError

    monkeypatch.setattr(app._metadata, "version", missing)
    assert app._resolve_version() == "unknown"
