<h1 align="center">🦉 Glaux</h1>
<p align="center"><strong>Turning sight into insight</strong></p>
<p align="center"><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a></p>

Glaux (Ancient Greek for *little owl*) is an agent harness for image and video analysis. You bring the model; Glaux provides the environment it runs in, turning images and video into verifiable, reproducible insight.

## What Glaux is

> **Agent = harness + model**

- **The model** does the reasoning. You bring it, and you can swap it.
- **Glaux is the harness.** It decides what the model can see, what it can do, how results are judged correct, and what is kept across tasks.

| Element | What Glaux handles |
| --- | --- |
| **Observation space** | Reads images and video across modalities and formats, with physical metadata (pixel spacing, channels, frame timing, sample rate); decides which part is presented to the model (tiles, sampled frames, crops, overlays, and audio segments aligned with the frames) |
| **Action space** | Tools for segmentation, measurement, tracking and reconstruction, backed by specialized models |
| **Verifier** | Results traceable to frames and regions, rerunnable as-is, cross-checked across methods, reviewed by humans; metrics when ground truth exists |
| **Episodes and trajectories** | Verified trajectories and human corrections kept as a case library |

These elements are still being built; the current chat preview does not include them yet.

## Scope and boundaries

| Category | Modalities | Common formats |
| --- | --- | --- |
| Natural images and video | Photos, video footage | PNG, JPEG, WebP; MP4, etc. |
| Microscopy and pathology | Brightfield and fluorescence microscopy; whole-slide pathology | TIFF; SVS, NDPI, MRXS, etc. |
| Medical imaging | Ultrasound, X-ray, CT, MRI, etc. | DICOM, NIfTI; PNG, TIFF |

- Glaux goes from images and video to computable representations; decisions and planning on top of them are yours to build.
- For biomedical use, Glaux is for research only, not clinical diagnosis.

## Current edition: chat preview

Connect your own model and start a conversation.

- **Included**: conversation history; session search, rename, archive and delete; streaming replies; stop and regenerate; image attachments (PNG, JPEG, WebP, GIF) handled by your vision-capable model.
- **Not included**: video; the workbench, image workspace, Atlas, segmentation and measurement tools. Their implementations remain in the source repository for future plugin delivery.
- No specialized models or weights are installed or downloaded.

## Quick start

The distribution is not publicly released yet. These steps work with a maintainer-provided offline bundle, or once the images are published.

- Install and start Docker (Docker Desktop on Windows / macOS, Docker Engine with Compose v2 on Linux).
- Download and extract `glaux-chat.zip`.
- Start: double-click `start.cmd` on Windows or `start.command` on macOS; run `bash start.sh` on Linux.
- In **Connection settings**, configure your model's API endpoint, API key and model, then start chatting.
- Stop: run the matching `stop` script. Conversation history lives in a Docker volume; **to keep it, do not run `docker compose down -v`**.

For data, troubleshooting, maintainer builds and distribution, and local development, see the [install, run and distribute guide](https://github.com/zhentai-sn/open-glaux/blob/main/docs/runbooks/chat-distribution.en.md).

## Documentation

- [Charter](https://github.com/zhentai-sn/open-glaux/blob/main/docs/roadmaps/charter.zh-CN.md) (Chinese)
- [Architecture](https://github.com/zhentai-sn/open-glaux/blob/main/docs/architecture.zh-CN.md) (Chinese)
- [Roadmap](https://github.com/zhentai-sn/open-glaux/tree/main/docs/roadmaps) (Chinese)

## License

[Apache-2.0](LICENSE)
