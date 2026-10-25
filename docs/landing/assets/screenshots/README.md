---
kind: living
status: living
---

# 落地页截图

`zh/` 使用应用中文界面，`en/` 使用英文界面，均为亮色主题的实际截图，分辨率为 1440 × 900。WebP 单张不超过 300 KB。

| 文件 | 内容 |
| --- | --- |
| `glaux-overview.webp` | 图像工作区（舞台 + 文件栏）与对话列 |
| `glaux-annotations.webp` | 咖啡杯上的两个人工框标注、标签目录条目与面积汇总 |
| `glaux-atlas.webp` | 四条示例案例组成的图谱库（上传入图，带标题与集合） |
| `glaux-context.webp` | 上下文页中的工具目录 |

截图来自隔离的临时工作区，仅加载仓库内 `data/natural` 示例。猫、咖啡杯和狗照片为 CC0 1.0，车辆照片为美国联邦政府作品；作者、来源和哈希见 [示例资产许可表](../../../../data/natural/README.md)。框标注与图谱标题为人工录入的演示数据，截图未使用私人数据、模型凭据或虚构的模型运行记录——界面里的「请先在连接设置中选择模型」「待补描述」都是未接模型时的真实状态。

两套图只有语言不同：数据源名（自然图像 / Natural images）、标注标签（咖啡杯、杯柄 / coffee cup、cup handle）、图谱集合与案例标题都按语言录入。标注使用标签目录里的条目，因此面板不出现「未目录」后缀。

重新截取时，分别将界面语言设为中文和英文、主题设为亮色。使用全新的浏览器上下文与隔离的会话、上传、图谱和标注目录，等待照片与标注完整显示后截图；更新同名 WebP，并核对语言、许可和体积。

隔离实例的做法：另起一套 `backend` / `agent-runtime` / `vite`（`GLAUX_HOME` 指向临时目录、`GLAUX_DEV_MODE=0`），把 `data/natural` 复制到该临时目录后经 `POST /datasources` 导入；标注与图谱用 `POST /annotations`、`POST /atlas/uploads` + `PATCH /atlas/exemplars/{id}` 播种，避免动到维护者自己的会话与项目。窗口固定 1440 × 900；英文那套的标注面板留 320 px，240 px 时「Confirmed · Manual · 112,225 px²」一行会溢出出横向滚动条。
