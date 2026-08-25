# 自然图像 SAM 演示集合设计

## 背景

Glaux 当前文件栏只展示颈动脉超声、胎儿头围、CT 和病理 WSI。`segment_region` 已接入 Gitee AI `sam3`，但自然图像没有可从查看器打开、再由 Agent Runtime 通过后端读取的稳定入口，难以在产品内完成通用目标分割走查。

本改动增加少量可随仓库分发的真实自然照片，用于验证现有 `segment_region → sam3 → propose_annotation` 链路。它们不是医学数据，也不进入 science-core 的测量任务注册表。

## 目标与非目标

目标：

- 文件栏常驻展示 `natural-images/`，内含约 4 张真实照片。
- 选择照片后使用现有 2D 查看器打开。
- Agent Viewer Context 携带当前 `image_id` 与 `modality=natural_image`。
- `segment_region` 能经现有 `/image/{id}` 取图并调用 SAM API。
- 自然图像不自动调用任何医学 `/task/run`。
- 每张照片记录来源、作者与许可，允许仓库再分发。

非目标：

- 不新增自然图像测量任务或 science-core `TaskPlugin`。
- 不实现任意文件上传、目录导入或在线图片搜索。
- 不更换 SAM 供应商、请求契约或外发门控。
- 不为自然图像建立标定、模型市场卡或生产级数据管理。

## 方案选择

采用独立 `natural_image` 数据集合。

不把照片混入 CUBS/HC 列表：混入会让自然照片继承错误的医学模态、活动模型和测量任务。也不由前端直接引用静态资源：Agent Runtime 需要通过后端 `/image/{id}` 取得同一张图，前端静态路径会形成第二套取图契约。

## 架构与数据流

### 数据与许可

- 照片放在 `data/natural/`。
- 选择约 4 张主体清晰、提示词容易复现的真实照片，覆盖单主体与多主体，例如猫、咖啡杯、车辆和人物/动物场景。
- `data/natural/README.md` 逐张记录原始页面、下载地址、作者、许可和建议测试提示词。
- 只接受逐张许可明确且允许再分发的来源；下载后保留原格式或统一转为后端已支持的 PNG/JPEG。

### 后端

- 契约中的 `Modality` 增加 `natural_image`。
- `GET /images?modality=natural_image` 从固定的 `data/natural/` 白名单发现照片并返回 `ImageMeta`。
- 现有 `GET /image/{image_id}` 增加自然图像解析分支；只允许列表中发现的 ID，拒绝路径穿越和任意文件读取。
- 自然图像元数据不提供 `cf`、测量方法或校准字段。
- 不在任务注册表新增自然图像任务，因此 `/task/run` 不接受或猜测自然图像任务。

### 前端

- Session Store 增加独立 `naturalImages` 列表，并扩展 `Modality` 为 `natural_image`。
- 应用初始化时加载自然图像列表；文件栏在任意医学模态下都显示 `natural-images/` 文件夹。
- 选择自然图像时：
  - 切换当前模态为 `natural_image`；
  - 设置 `activeImage` 和对应元数据；
  - 清空活动 volume、slide、医学度量和检测叠加；
  - 不调用 `runCurrentTask`。
- `natural_image` 没有 `TaskView` 时，查看器按既有兜底选择 `raster_2d`。
- 医学模态切换按钮保持来自任务注册表；点击任一医学模态可离开自然图像。

### Agent Runtime

- 前端 `toViewerContext()` 在自然图像下输出 `image_id` 与 `modality=natural_image`，不输出 `task`、`method` 或标定。
- `segment_region` 继续从 Viewer Context 取得 `image_id`，经后端 `/image/{id}` 拉取字节，并沿用现有外发开关与 token 门控。
- `propose_annotation` 继续把 SAM 多边形作为建议态标注写入，人工确认流程不变。

## 错误处理

- 图片缺失或格式不支持：列表不暴露该项；直接请求未知 ID 返回 404。
- 路径穿越或伪造 ID：返回 404，不回显任意本地路径内容。
- 未开启 `GLAUX_ANNOT_ALLOW_EGRESS` 或未配置 `GLAUX_SEG_API_TOKEN`：保持现有行为，`segment_region` 不注册。
- SAM 额度、超时和零命中：保持现有错误映射与零结果提示。
- 下载来源不可用或许可不清晰：替换候选照片，不把不确定资产提交进仓库。

## 测试与验收

后端：

- 自然图像列表返回稳定 ID 和正确元数据。
- 每个 ID 返回正确图片媒体类型与非空字节。
- 未知 ID、路径穿越和非白名单文件返回 404。
- 自然图像不会进入 `/task/run` 的任务分派。

前端：

- 文件栏显示 `natural-images/` 与照片条目。
- 选择照片后挂载 2D 查看器、更新活动对象并清空医学状态。
- 选择照片不调用 `/task/run`。
- Viewer Context 不携带医学任务或标定。

端到端：

- 启动三个服务并配置既有 SAM 外发开关与 token。
- 打开至少两张自然照片，分别用简单英文名词提示调用 `segment_region`。
- 验证返回候选多边形，并可经 `propose_annotation` 显示为待确认标注。

