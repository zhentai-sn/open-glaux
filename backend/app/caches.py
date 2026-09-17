"""数据加载层缓存的统一失效入口（技术债审计 D5）。

问题：`dataset.list_ids()` 等挂着 `lru_cache`，而运行期可以增删数据源
（`POST /datasources`、`POST /datasources/samples`、`POST /uploads/images`、
`DELETE /datasources/{id}`）。两件事凑在一起 = **进程活着时磁盘上的变化对 `/images` 不可见**，
只能靠重启绕过——`scripts/dev/restart-backend.sh` 的注释一直把这条债写在脸上。

放在独立模块而不是 `datasource_registry` 里，是为了保住注册表「纯 stdlib + config、无 science-core
依赖」的定位：这里的模块（`dataset` 等）会 import `glaux_core`，注册表不能在模块级碰它们。
注册表以**函数内延迟导入**调用本模块，与它既有的延迟导入风格一致。

逐个模块 try/except：缺 science-core 或缺 openslide 时对应模块本就 import 不进来，
那种环境下也不存在要失效的缓存，跳过即可，不该让一次数据源增删失败。
"""

from __future__ import annotations

from importlib import import_module

#: (模块名, 被 lru_cache 装饰的属性名)。新增缓存时在此登记一行。
_CACHED: tuple[tuple[str, str], ...] = (
    ("dataset", "list_ids"),  # 决定「有哪些图」——最直接的陈旧面
    ("hc_real", "_ds"),  # 持有 Hc18Dataset 实例，内含自己的 list
    ("dataset_ct", "_load_nifti"),  # 持有影像内容
    ("dataset_wsi", "_open"),  # 持有 OpenSlide 句柄——源被删后还攥着已消失的文件
    ("dataset_wsi", "_deepzoom"),
)


def clear_dataset_caches() -> None:
    """清空全部数据加载层缓存。数据源发生增删后调用，使下一次读取重新扫盘。"""
    for module_name, attr in _CACHED:
        try:
            module = import_module(f".{module_name}", __package__)
        except Exception:  # noqa: BLE001 — 缺可选依赖时该模块本就不可用，无缓存可清
            continue
        cache_clear = getattr(getattr(module, attr, None), "cache_clear", None)
        if cache_clear is not None:
            cache_clear()
