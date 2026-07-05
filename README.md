<h1 align="center">🦉 Glaux</h1>

<p align="center"><strong>Biomedical Image Insight</strong></p>

<p align="center">
  An AI-native platform for biomedical image analysis and computation —<br>
  turn any biomedical image, in any modality, into computable, reusable structure, using natural language.
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

Glaux is an **AI-native platform for biomedical image analysis and computation**. You describe what you
want in plain language; Glaux turns the image into structured, computable, reusable results — segmentations,
measurements, reconstructions — across biomedical imaging modalities.

Think of it as **the ImageJ of the AI-native era, unbound from the microscope**: the scientific rigor of
quantitative imaging (reproducible masks, measurements, provenance), driven by natural language, no longer
tied to a single instrument or modality.

## Why Glaux?

Quantitative bioimage analysis today means stitching together ImageJ macros, CellProfiler pipelines, and
one-off scripts — powerful, but slow, brittle, and gated behind expertise. Our moat is not another format
decoder; it is the **natural-language-driven pipeline from image to structured knowledge**, which is largely
modality-agnostic: structure is structure, whether the pixels came from a microscope, an ultrasound probe,
or a CT slice. Outputs are computable artifacts downstream tools can build on — not screenshots.

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

- [ ] Lock engineering standards for the new repo
- [ ] Migration plan: port the reusable core (decode · segment · measure) from the prototype
- [ ] First end-to-end natural-language → segmentation loop
- [ ] Modality feasibility spikes (beyond fluorescence microscopy)

## Contributing

Contribution guidelines will land alongside the engineering standards. Early feedback and discussion are
welcome via issues.

## License

**TBD** — expected to be permissive (MIT or Apache-2.0), finalized before the first release.
