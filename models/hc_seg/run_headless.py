"""HC18 胎儿头围分割——隔离子进程推理驱动（torch-CPU，只在 .venv-hc 内运行）。

镜像 caroSegDeep 的隔离范式：torch/cv2 等重后端**绝不进入 FastAPI 主进程**，统一封在
各自的 .venv-* 子进程里。本驱动用 HuggingFace ``gauravxthakur/Fetal-Head-Biometry``
的 **CSM**（Convolutional Segmentation Machine，Apache-2.0，权重 test_model.pth）对
单张 HC18 图推理，逐字复现该仓库经验证的推理/后处理口径：

  原图(灰度) → img_crop 居中裁到 (512,768)[仅平移不缩放，保标定] → 缩放到 (192,128)/255
  → CSM → y3(32×48) 阈值 → 最大连通域(填充头区) → Canny 边缘
  → 边缘点/中心按 u=16 上采样回 (512,768) 裁剪像素空间

产出两份缓存供主进程（纯 numpy/PIL）读取：
  ① <id>-contour.txt  颅骨轮廓边缘点 (x y，裁剪空间像素)——喂 science-core fit_ellipse
     → Ramanujan 周长 × pixel_size(mm/px) 得 HC(mm)，曲线原生、可复现。
  ② <id>-mask.png     (512,768) 填充头区二值掩膜——供 Dice。

**torch/cv2 全隔离在此**，产出为曲线原生几何，不在子进程臆造 HC。裁剪不改变像素尺度，
故裁剪空间的周长(px) × CSV 的 pixel size(mm/px) 与官方参考 HC(mm) 同口径可比。

许可证：CSM 上游 Apache-2.0；HC18 数据集 CC-BY-4.0。权重 pickle 经静态操作码审查
（仅 OrderedDict/torch 张量重建全局，无系统调用）。

用法：run_headless.py <images_dir> <out_dir> <weights.pth> <image_id>
其中 image_id 如 ``000_HC`` / ``032_2HC``（对应 <images_dir>/<image_id>.png）。
"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn as nn

CROP = (512, 768)   # img_crop 目标 (行,列) = (H,W)
K1 = 4              # 输入下采样：模型输入 (128,192)
USCALE = 16         # 预测(32×48) → 裁剪(512,768) 的上采样因子（=CROP/预测尺寸）


# --- CSM 架构（逐字复现上游 modules.py，以加载其 state_dict） ------------------
class CSM_stagen(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(17, 17, 11, padding=5, groups=17), nn.Conv2d(17, 32, 1),
            nn.BatchNorm2d(32), nn.ReLU(True),
            nn.Conv2d(32, 32, 11, padding=5, groups=32), nn.Conv2d(32, 64, 1),
            nn.BatchNorm2d(64), nn.ReLU(True),
            nn.Conv2d(64, 64, 11, padding=5, groups=64), nn.Conv2d(64, 32, 1),
            nn.BatchNorm2d(32), nn.ReLU(True),
            nn.Conv2d(32, 16, 1), nn.BatchNorm2d(16), nn.ReLU(True),
            nn.Conv2d(16, 1, 1), nn.Sigmoid(),
        )

    def forward(self, x):
        return self.conv(x)


class CSM(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.stage1 = nn.Sequential(
            nn.Conv2d(1, 8, 9, padding=4), nn.BatchNorm2d(8), nn.ReLU(True), nn.MaxPool2d(2),
            nn.Conv2d(8, 8, 9, padding=4, groups=8), nn.Conv2d(8, 16, 1),
            nn.BatchNorm2d(16), nn.ReLU(True), nn.MaxPool2d(2),
            nn.Conv2d(16, 16, 9, padding=4, groups=16), nn.Conv2d(16, 32, 1),
            nn.BatchNorm2d(32), nn.ReLU(True), nn.MaxPool2d(2),
            nn.Conv2d(32, 32, 5, padding=2, groups=32), nn.Conv2d(32, 64, 1),
            nn.BatchNorm2d(64), nn.ReLU(True),
            nn.Conv2d(64, 64, 9, padding=4, groups=64), nn.Conv2d(64, 32, 1),
            nn.BatchNorm2d(32), nn.ReLU(True),
            nn.Conv2d(32, 16, 1), nn.ReLU(True), nn.Conv2d(16, 1, 1), nn.Sigmoid(),
        )
        self.f1 = nn.Sequential(
            nn.Conv2d(1, 8, 9, padding=4), nn.BatchNorm2d(8), nn.ReLU(True), nn.MaxPool2d(2),
            nn.Conv2d(8, 16, 9, padding=4), nn.BatchNorm2d(16), nn.ReLU(True), nn.MaxPool2d(2),
            nn.Conv2d(16, 32, 9, padding=4), nn.BatchNorm2d(32), nn.ReLU(True),
        )
        self.f2 = nn.Sequential(
            nn.MaxPool2d(2), nn.Conv2d(32, 16, 5, padding=2), nn.BatchNorm2d(16), nn.ReLU(True),
        )
        self.up = nn.UpsamplingBilinear2d(scale_factor=2)
        self.f3 = nn.Sequential(
            nn.Conv2d(32, 16, 3, padding=1), nn.BatchNorm2d(16), nn.ReLU(True),
            nn.Conv2d(16, 16, 3, padding=1), nn.BatchNorm2d(16), nn.ReLU(True),
        )
        self.stage2 = CSM_stagen()
        self.stage3 = CSM_stagen()

    def forward(self, x):
        y1 = self.stage1(x)
        x_f1 = self.f1(x)
        x_f2 = self.f2(x_f1)
        x_f3 = self.f3(x_f1)
        y2 = self.stage2(torch.cat([y1, x_f2], 1))
        y2_up = self.up(y2)
        y3 = self.stage3(torch.cat([y2_up, x_f3], 1))
        return y1, y2, y3


def img_crop(in_img: np.ndarray) -> tuple[np.ndarray, int, int]:
    """居中裁剪到 (512,768)——逐字复现上游 img_crop（仅平移，保像素尺度）。

    额外返回 (dr, dc)：裁剪空间坐标 +(dc,dr) 即回到原图坐标（供叠加/Dice 用原图系）。
    仅处理原图 ≥ 裁剪尺寸的常规情形（HC18 标准 800×540）。
    """
    r_out, c_out = CROP
    out = np.zeros([r_out, c_out], dtype=in_img.dtype)
    r_in, c_in = in_img.shape
    dr = int((r_in - r_out) / 2 + 0.5)
    dc = int((c_in - c_out) / 2 + 0.5)
    if dr > 0:
        rp_in, rp_out, off_r = [dr, dr + r_out], [0, r_out], dr
    else:
        dr = -dr; rp_in, rp_out, off_r = [0, r_in], [dr, dr + r_in], -dr
    if dc > 0:
        cp_in, cp_out, off_c = [dc, dc + c_out], [0, c_out], dc
    else:
        dc = -dc; cp_in, cp_out, off_c = [0, c_in], [dc, dc + c_in], -dc
    out[rp_out[0]:rp_out[1], cp_out[0]:cp_out[1]] = in_img[rp_in[0]:rp_in[1], cp_in[0]:cp_in[1]]
    return out, off_r, off_c


def _max_cc(bin_img: np.ndarray) -> np.ndarray:
    """最大非背景连通域（填充头区）——复现上游 mcc_edge 的选择口径。"""
    retval, labels, stats, _ = cv2.connectedComponentsWithStats(bin_img, connectivity=4)
    if retval <= 1:
        return np.zeros_like(bin_img)
    order = np.argsort(-stats[:, 4])  # 按面积降序；order[0]=背景
    return ((labels == order[1]) * 255).astype("uint8")


def main() -> int:
    if len(sys.argv) != 5:
        print("用法：run_headless.py <images_dir> <out_dir> <weights.pth> <image_id>", file=sys.stderr)
        return 2
    images_dir, out_dir, weights, image_id = (
        Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4]
    )
    img_path = images_dir / f"{image_id}.png"
    if not img_path.is_file():
        print(f"图像不存在：{img_path}", file=sys.stderr)
        return 3
    out_dir.mkdir(parents=True, exist_ok=True)

    img = cv2.imread(str(img_path), 0)
    if img is None:
        print(f"读图失败：{img_path}", file=sys.stderr)
        return 3
    H0, W0 = img.shape  # 原图尺寸（叠加/Dice 的坐标系）
    crop, dr, dc = img_crop(img)
    w, h = int(CROP[1] / K1), int(CROP[0] / K1)  # (192,128)
    x = cv2.resize(crop, (w, h), interpolation=cv2.INTER_AREA).astype("float32") / 255.0

    net = CSM()
    net.load_state_dict(torch.load(str(weights), map_location="cpu"))  # 用户授权普通加载
    net.eval()  # 关键：BN 用 running stats、Dropout 关闭
    with torch.no_grad():
        _, _, y3 = net(torch.from_numpy(x)[None, None])
    pred = np.round(y3[0, 0].numpy()).astype("uint8") * 255  # 32×48 二值

    filled = _max_cc(pred)  # 填充头区（预测分辨率）
    if int((filled > 0).sum()) < 8:
        print(f"分割前景过少（{int((filled>0).sum())} px），颅环检测失败", file=sys.stderr)
        return 4
    edge = cv2.Canny(filled, 50, 250)  # 颅骨轮廓边缘

    ys, xs = np.where(edge == 255)  # (行,列)
    # u=16 上采样回 (512,768) 裁剪空间，再 +(dc,dr) 回原图坐标系（裁剪仅平移，周长不变）
    xc = (xs.astype(float) + 0.5) * USCALE - 0.5 + dc
    yc = (ys.astype(float) + 0.5) * USCALE - 0.5 + dr
    pts = np.column_stack([xc, yc])  # (N,2) x=列 y=行，原图像素
    if pts.shape[0] < 5:
        print(f"边缘点不足（{pts.shape[0]}），无法拟合椭圆", file=sys.stderr)
        return 4
    np.savetxt(out_dir / f"{image_id}-contour.txt", pts, fmt="%.1f")

    # 填充掩膜：裁剪空间(512,768)上采样后放回原图尺寸（供原图系 Dice）
    crop_mask = cv2.resize(filled, (CROP[1], CROP[0]), interpolation=cv2.INTER_NEAREST)
    mask = np.zeros((H0, W0), dtype="uint8")
    r1, c1 = min(dr + CROP[0], H0), min(dc + CROP[1], W0)
    mask[dr:r1, dc:c1] = crop_mask[: r1 - dr, : c1 - dc]
    cv2.imwrite(str(out_dir / f"{image_id}-mask.png"), mask)
    print(f"OK {image_id}: filled_px={int((filled>0).sum())} edge_pts={pts.shape[0]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
