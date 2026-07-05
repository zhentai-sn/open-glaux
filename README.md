<h1 align="center">🦉 Glaux</h1>

<p align="center"><strong>Biomedical Image Insight Agents</strong></p>

<p align="center">
  Agent-native AI for biomedical imaging —<br>
  describe a research goal in natural language; Glaux's agents plan, segment, measure, and verify,<br>
  turning any biomedical image, in any modality, into computable, reproducible insight.
</p>

<p align="center">
  <strong>English</strong> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-pre--alpha-orange">
  <img alt="stage" src="https://img.shields.io/badge/stage-pre--research-blueviolet">
  <img alt="PRs" src="https://img.shields.io/badge/PRs-welcome-brightgreen">
  <img alt="license" src="https://img.shields.io/badge/license-TBD-lightgrey">
</p>

> **Glaux** (/ɡlaʊks/, from Greek **γλαύξ**, Athena's little owl) — the bird of wisdom that sees in the
> dark. That is what Glaux is for: seeing into the image.

---

## What is Glaux?

Glaux is a system of **agent-native tools for biomedical image insight**. You describe a research goal in
plain language; Glaux's agents plan the analysis, run segmentation and measurement, verify the result, and
hand back structured, reproducible insight — across biomedical imaging modalities.

The agent is what you talk to; underneath sits a **verified, modality-agnostic substrate** (decoders,
segmenters, measurement primitives) with provenance and reproducibility built in — not a thin wrapper over a
model. Think of it as **the ImageJ of the agent-native era, unbound from the microscope**: the scientific
rigor of quantitative imaging, delivered by agents you direct in plain language, no longer tied to a single
instrument or modality.

## Why Glaux?

Quantitative bioimage analysis today means stitching together ImageJ macros, CellProfiler pipelines, and
one-off scripts — powerful, but slow, brittle, and gated behind expertise. Our bet is not another
natural-language front door onto that mess — general-purpose agents will commoditize that. It is **agents
that stand on a verified, modality-agnostic substrate and are accountable for the result**: you give a goal,
not a script; they plan, act, verify, and iterate; every result carries provenance and can be re-run —
insight you can defend in peer review, not a screenshot. Structure is structure, whether the pixels came
from a microscope, an ultrasound probe, or a CT slice.

## Scope

Glaux owns the pipeline from **image → understanding → representation**. What you do with that
representation (decisions, planning, simulation) you build *on top of* Glaux — that boundary is deliberate.

| In scope | Deliberately out of scope |
| --- | --- |
| Natural-language-driven segmentation & measurement | **Production clinical diagnosis** (software-as-a-medical-device) |
| Morphometric / quantitative analysis | Real-time intra-operative decision support |
| Reconstruction & richer representations | Surgical planning / simulation as a core promise |
| Retrospective research on de-identified clinical data | |

Glaux is a **research** tool: IRB-governed, retrospective studies on de-identified data are in scope;
regulated clinical diagnosis (FDA / NMPA) is not. The line is **research insight, not clinical decision**.

## Architecture

<p align="center">
  <img src="assets/architecture.svg" alt="Glaux architecture — Web proxies natural-language + image requests to a stateless science-core that decodes, segments, and measures" width="640">
</p>

- **Web** — the workspace and natural-language layer; never touches raw pixels, proxies to the science core.
- **science-core** — a stateless Python service that decodes, segments, and measures. New modalities and
  segmenters plug in behind a narrow contract (a strategy registry), not a rewrite.

The engine is being ported from a working fluorescence-microscopy prototype; this repo is the clean restart.

## Status

**Pre-alpha · pre-research.** The direction here is a north star we are building toward, not a shipped
guarantee — we would rather say that honestly than oversell.

## Roadmap

**North star:** Biomedical Image Insight Agents — agents that deliver verified, reproducible insight across
modalities, built on assets that get *more* valuable as models improve.

The living roadmap and the strategy behind it live under [docs/roadmaps/](docs/roadmaps/) — current:
[Product Roadmap · 2026-07-05](docs/roadmaps/20260705-product-roadmap.zh-CN.md). The competitive and
positioning analysis that informs it lives under [docs/researches/](docs/researches/).

## Contributing

Contribution guidelines will land alongside the engineering standards. Early feedback and discussion are
welcome via issues.

## License

**TBD** — expected to be permissive (MIT or Apache-2.0), finalized before the first release.
