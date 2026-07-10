# data/wsi — 病理 WSI demo 资产（P7 楔子）

- `slide_001.svs` —— OpenSlide 可再分发测试数据 `CMU-1-Small-Region.svs`（Aperio，~1.9 MB，
  2220×2967 px，MPP 0.499 µm/px）。下载见
  [docs/runbooks/p7-wsi-nuclei-wedge.md](../../docs/runbooks/p7-wsi-nuclei-wedge.md) 第 3 步。

- `slide_001_ref_nuclei.json` —— **reproducibility reference**：StarDist-HE 在 canonical ROI
  `(1200,1200,1712,1712)` 上的检测输出（质心 level-0 px + class_id）。`GET /wsi/{id}/verify`
  与之比质心匹配 F1。

  **非真 GT**：这是模型自身的输出，衡量「管线能否复现自身 ROI 检测」（确定性 + 缓存 → F1≈1.0），
  **不是**病理专家标注、不代表临床正确性——语义诚实标注同 P6 的 Reproducibility Dice。
  由 runbook 第 6 步真跑后从 `WSI_SEG_CACHE` 拷得。
