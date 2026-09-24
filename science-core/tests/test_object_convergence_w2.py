"""SDD 10 W2（science-core 侧）：标定派发、Detection.region、Primitive.at、TaskPlugin 新字段。"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

import pytest

from glaux_core.calibration.calibration import (
    CFSource,
    calibration_from_dict,
    resolve_calibration_for,
    resolve_video_calibration,
)
from glaux_core.contracts import (
    Bbox,
    ClassSpec,
    Detection,
    EllipseShape,
    Mask,
    PointSet,
    Polyline,
    VolumeMask,
    detection_to_dict,
    primitive_from_dict,
    primitive_to_dict,
)
from glaux_core.errors import HardReject
from glaux_core.tasks import (
    LIVER_KIDNEY_CLASSES,
    NUCLEI_CLASSES,
    REGISTRY,
    TaskType,
    plugin_to_view,
)

# --- 标定派发 -----------------------------------------------------------------


def test_from_dict_mm_per_px():
    r = calibration_from_dict({"kind": "mm_per_px", "value": 0.06, "source": "cubs"})
    assert r.source == CFSource.CUBS and r.source.value == "cubs"
    assert r.cf == 0.06 and r.value == 0.06
    assert r.provenance == {"cf": 0.06, "source": "cubs"}


def test_from_dict_voxel_mm():
    r = calibration_from_dict({"kind": "voxel_mm", "value": [0.8, 0.8, 2.5], "source": "nifti"})
    assert r.source == CFSource.VOXEL_SPACING
    assert r.value == (0.8, 0.8, 2.5) and r.cf == 0.0


def test_from_dict_mpp_um():
    r = calibration_from_dict({"kind": "mpp_um", "value": (0.25, 0.26), "source": "openslide"})
    assert r.source == CFSource.MPP and r.value == (0.25, 0.26)


def test_from_dict_time_base():
    r = calibration_from_dict(
        {"kind": "time_base", "value": {"fps": 30, "time_base": "1/30000"}, "source": "ffprobe"}
    )
    assert r.source == CFSource.TIME_BASE and r.source.value == "time_base"
    assert r.value == 30.0 and isinstance(r.value, float)
    assert r.provenance == {"fps": 30, "time_base": "1/30000", "source": "container"}


def test_resolve_video_calibration_rejects_nonpositive():
    for bad in (0, -1, None, "x", float("nan")):
        with pytest.raises(HardReject):
            resolve_video_calibration(bad)  # type: ignore[arg-type]


def test_from_dict_unknown_kind_rejects_and_logs(caplog):
    with (
        caplog.at_level(logging.WARNING, logger="glaux.calibration"),
        pytest.raises(HardReject),
    ):
        calibration_from_dict({"kind": "dicom_regions", "value": [1], "source": "dicom"})
    msgs = [r.getMessage() for r in caplog.records if r.name == "glaux.calibration"]
    assert msgs and "dicom_regions" in msgs[0] and "dicom" in msgs[0]


def test_from_dict_missing_kind_rejects():
    with pytest.raises(HardReject):
        calibration_from_dict({"value": 0.1, "source": "x"})
    with pytest.raises(HardReject):
        calibration_from_dict("not a mapping")  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "d",
    [
        {"kind": "mm_per_px", "value": 0},
        {"kind": "mm_per_px", "value": -0.1},
        {"kind": "mm_per_px", "value": "0.1"},
        {"kind": "mm_per_px", "value": True},
        {"kind": "mm_per_px", "value": None},
        {"kind": "voxel_mm", "value": [1.0, 1.0]},
        {"kind": "voxel_mm", "value": [1.0, 0.0, 1.0]},
        {"kind": "voxel_mm", "value": ["a", "b", "c"]},
        {"kind": "voxel_mm", "value": 1.0},
        {"kind": "voxel_mm", "value": "abc"},
        {"kind": "mpp_um", "value": [0.25]},
        {"kind": "mpp_um", "value": [0.25, -1]},
        {"kind": "mpp_um", "value": None},
        {"kind": "time_base", "value": 30},
        {"kind": "time_base", "value": {"time_base": "1/30"}},
        {"kind": "time_base", "value": {"fps": 0}},
    ],
)
def test_from_dict_malformed_rejects(d):
    with pytest.raises(HardReject):
        calibration_from_dict(d)


def test_resolve_calibration_for_none_rejects():
    @dataclass
    class Obj:
        calibration: object = None

    with pytest.raises(HardReject):
        resolve_calibration_for(Obj())
    with pytest.raises(HardReject):
        resolve_calibration_for(None)


def test_resolve_calibration_for_dict_and_object():
    cal = {"kind": "mm_per_px", "value": 0.05, "source": "cubs"}
    assert resolve_calibration_for(cal).cf == 0.05

    @dataclass
    class Obj:
        calibration: dict

    assert resolve_calibration_for(Obj(cal)).cf == 0.05


def test_resolve_calibration_for_model_dump():
    class FakeModel:
        def model_dump(self):
            return {"kind": "mpp_um", "value": [0.5, 0.5], "source": "openslide"}

    @dataclass
    class Obj:
        calibration: object

    assert resolve_calibration_for(Obj(FakeModel())).value == (0.5, 0.5)
    assert resolve_calibration_for(FakeModel()).source == CFSource.MPP


# --- Detection.region -----------------------------------------------------------


def test_detection_region_default_and_serialized():
    det = Detection(primitives=(), model_version="stub@0")
    assert det.region is None
    assert detection_to_dict(det)["region"] is None
    region = {"kind": "column_window", "x0": 10, "x1": 90}
    det = Detection(primitives=(), model_version="m", region=region)
    dd = detection_to_dict(det)
    assert dd["region"] == region and "roi_used" not in dd
    json.dumps(dd)


# --- Primitive.at -------------------------------------------------------------

_CLS = (ClassSpec(1, "liver", "肝", "Liver", "#FF8A5B"),)


def _all_primitives(at):
    return [
        Polyline("LI", "LI", ((0.0, 1.0), (2.0, 3.0)), False, at),
        EllipseShape("e", 1.0, 2.0, 3.0, 2.0, 0.1, "skull", at),
        Mask("m", "ref.png", "mask", at),
        Bbox("b", 0.0, 0.0, 5.0, 5.0, "bbox", at),
        VolumeMask("v", "/api/volume/x/labelmap", _CLS, "/api/objects/x/raw", at=at),
        PointSet("p", ((1.0, 2.0),), (1,), _CLS, (0.0, 0.0, 4.0, 4.0), "nuclei", at),
    ]


@pytest.mark.parametrize("prim", _all_primitives(None))
def test_primitive_at_absent_when_none(prim):
    assert prim.at is None
    d = primitive_to_dict(prim)
    assert "at" not in d
    assert primitive_from_dict(d).at is None


@pytest.mark.parametrize("prim", _all_primitives({"t": 10}))
def test_primitive_at_roundtrip(prim):
    d = primitive_to_dict(prim)
    assert d["at"] == {"t": 10}
    back = primitive_from_dict(json.loads(json.dumps(d)))
    assert back.at == {"t": 10}
    assert primitive_to_dict(back) == d


def test_primitive_at_positional_construction_unaffected():
    p = Polyline("LI", "LI", ((0.0, 0.0),), True)
    assert p.closed is True and p.at is None
    b = Bbox("b", 0, 0, 1, 1, "roi")
    assert b.role == "roi" and b.at is None


# --- TaskPlugin 新字段 ----------------------------------------------------------


def test_registry_rows_object_kinds_trigger_classes():
    imt = REGISTRY[TaskType.FAR_WALL_CCA_IMT]
    assert imt.object_kinds == ("image",) and imt.trigger == "on_open" and imt.classes == ()
    hc = REGISTRY[TaskType.FETAL_HC]
    assert hc.object_kinds == ("image",) and hc.trigger == "on_open" and hc.classes == ()
    ct = REGISTRY[TaskType.TOTALSEG_LIVER_KIDNEY]
    assert ct.object_kinds == ("volume",) and ct.trigger == "on_open"
    assert ct.classes == LIVER_KIDNEY_CLASSES
    assert ct.capabilities == ("bbox", "polygon", "brush", "voi", "z_scroll")
    wsi = REGISTRY[TaskType.NUCLEI_DETECTION]
    assert wsi.object_kinds == ("slide",) and wsi.trigger == "on_region"
    assert wsi.classes == NUCLEI_CLASSES
    assert wsi.capabilities == ("bbox", "polygon", "verify")


def test_registry_invariants():
    valid_kinds = {"image", "volume", "slide", "video"}
    for plugin in REGISTRY.values():
        assert plugin.object_kinds and set(plugin.object_kinds) <= valid_kinds
        assert plugin.trigger in {"on_open", "on_region", "manual"}
    # D-18：不为无任务模态造空行
    assert len(REGISTRY) == 4
    assert all(p.modality not in {"natural_image", "video"} for p in REGISTRY.values())
    assert all("video" not in p.object_kinds for p in REGISTRY.values())


def test_plugin_to_view_new_keys_and_legacy_keys():
    legacy = {
        "task", "adapter_kind", "modality", "label", "default_method",
        "metrics", "tools", "overlays", "capabilities", "on_commit",
    }
    for plugin in REGISTRY.values():
        view = plugin_to_view(plugin)
        assert legacy <= set(view)
        assert view["object_kinds"] == list(plugin.object_kinds)
        assert view["trigger"] == plugin.trigger
        assert len(view["classes"]) == len(plugin.classes)
        json.dumps(view)
    ct = plugin_to_view(REGISTRY[TaskType.TOTALSEG_LIVER_KIDNEY])
    assert ct["classes"][0] == {
        "class_id": 1, "role": "liver", "label": {"en": "Liver", "zh": "肝"},
        "color": "#FF8A5B", "measurable": True,
    }
    wsi = plugin_to_view(REGISTRY[TaskType.NUCLEI_DETECTION])
    assert [c["role"] for c in wsi["classes"]] == ["nucleus"]
