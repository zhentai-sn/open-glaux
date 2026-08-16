<h1 align="center">🦉 Glaux</h1>

<p align="center"><strong>Biomedical Image Insight Agents</strong></p>

<p align="center">
  Describe a research goal in natural language, and turn<br>
  any biomedical image, in any modality, into verified, reproducible insight.
</p>

<p align="center">
  <strong>English</strong> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-pre--alpha-orange">
  <img alt="stage" src="https://img.shields.io/badge/stage-pre--research-blueviolet">
  <img alt="license" src="https://img.shields.io/badge/license-Apache--2.0-blue">
</p>

> **Glaux** (/ɡlaʊks/, from Greek **γλαύξ**, Athena's little owl) — the bird of wisdom that sees in the dark.

---

## What is Glaux?

Glaux is an **agent that understands biomedical images, together with the environment it needs to do the
work**. It works out of the box: describe your research goal in plain language — say, "measure the carotid
intima thickness across this batch of ultrasound scans" — and the agent plans the steps, processes the
images, checks its own results, and iterates until it hands you an answer you can inspect and re-run.

The agent does the thinking; the environment makes sure it does the work correctly: it reads images from
microscopes, ultrasound, CT and more the right way; measurements come in real physical units with proper
calibration; every step is recorded so results can be reproduced at any time. You can also swap in your own
model as the agent's brain — the environment stays the same.

## Why Glaux?

However capable a model is, it doesn't come knowing how to read a pathology slide correctly, how to convert
pixels into microns, or how to prove its result is right — that is what Glaux adds.

- **The environment is the core value.** Image reading, calibrated measurement, result checking and record
  keeping — the stronger the model, the more useful these become, not less.
- **Checkable and reproducible by default.** Every conclusion traces back to each step and can be re-run —
  it holds up in peer review, unlike a screenshot.
- **Any imaging method.** Microscope, ultrasound probe, CT slice — if it's a biomedical image, the approach
  is the same.
- **Built-in Atlas.** Import textbook figures, paper images, or annotated datasets as reference examples; the
  agent looks up similar cases before acting, instead of guessing from scratch.
- **Ready out of the box.** The repo ships with an agent — install and go; bring your own model if you prefer.

## Scope

Glaux covers the path from **image** to **understanding** to **usable results**. What you do with those
results — decisions, planning, simulation — you build on top of Glaux yourself. That boundary is deliberate.

| In scope | Deliberately out of scope |
| --- | --- |
| Natural-language-driven image segmentation & measurement | **Clinical diagnosis products** (software regulated as a medical device) |
| Quantitative analysis of shape and count | Real-time decision support during surgery |
| 3D reconstruction and richer representations | Surgical planning / simulation as a core promise |
| Retrospective research on de-identified clinical data | |

Glaux is a **research** tool: ethics-approved, retrospective studies on de-identified data are in scope;
clinical diagnosis requiring regulatory approval (FDA / NMPA) is not. The line is **research insight, not
clinical decision**.

## Architecture

<p align="center">
  <img src="assets/architecture.svg" alt="Glaux architecture — an agent runs inside the Glaux environment, whose four layers (representation, action, verification, memory) turn any-modality images into verified, reproducible insight" width="640">
</p>

The local runtime is three processes (`make -j3 dev` starts them all), plus isolated model processes on demand:

- **Agent (`agent-runtime/`, Node.js · Fastify · Pi Agent Core)** — does the thinking and decision-making.
  One ships with the repo, or configure your own API / model; it plans, acts, checks, and corrects, and acts on
  the environment through tools such as `run_task`. **It is the only process that talks to a model**; keys
  live here and nowhere else.
- **Web (`frontend/`, React · Vite · Cornerstone3D · OpenSeadragon)** — where you talk to the agent and view
  images and results; it doesn't process images itself, it hands requests to the agent and the backend.
- **Backend + science-core (`backend/` thin FastAPI layer + `science-core/` in Python)** — the part that
  actually processes images: reading, segmentation, measurement, reconstruction, with checks and an operation
  record on every result. The task registry in `science-core` is the single list of what the environment can
  do; new imaging methods or algorithms plug in through the same interface.
- **Isolated models (`models/`)** — heavy models (e.g. TotalSegmentator, StarDist) run as subprocesses in
  their own virtual environments; the main process never loads PyTorch / TensorFlow.

The environment's four layers — representation (eyes), action (hands), verification (referee), memory
(experience, including the Atlas) — are the four rows in the diagram. The core value is the environment, not
any particular agent; for the full runtime topology and repo layout see
[docs/architecture.zh-CN.md](docs/architecture.zh-CN.md).

## Status

**Pre-alpha · pre-research.** The direction here is a goal we are building toward, not a shipped guarantee —
we would rather say that honestly than oversell.

## Roadmap

**North star:** Biomedical Image Insight Agents — agents that deliver checkable, reproducible insight across
imaging methods, built on capabilities that get *more* valuable as models improve.

1. **Vision & strategy** — positioning and core value (largely done; see the analysis below).
2. **Preliminary requirements** — target users, use cases, functional & non-functional scope.
3. **Technical architecture** — reusable core, agent orchestration, checkable-result contract.
4. **Validate on 1–2 scenarios** — deliberately non-fluorescence: pathology slides (WSI) and ultrasound.

🔭 **Far horizon** — platform / external distribution, coverage of all imaging methods, and eventually
assistive decision support (a long-term goal beyond today's research-only line).

The living roadmap and the strategy behind it live under [docs/roadmaps/](docs/roadmaps/) — current:
[Product Roadmap · 2026-07-05](docs/roadmaps/20260705-product-roadmap.zh-CN.md). The competitive and
positioning analysis that informs it lives under [docs/researches/](docs/researches/).

## License

[Apache-2.0](LICENSE)
