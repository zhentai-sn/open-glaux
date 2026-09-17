# Chat preview: install, run and distribute

> Spec: [SDD 09](../sdd/feats/09-chat-distribution/README.md) (Chinese) · 中文：[chat-distribution.md](chat-distribution.md)

## Release status

- The Docker distribution is being prepared. Public images and a downloadable release are not published yet.
- The steps below work with a maintainer-provided offline bundle, or once the matching images are published.
- Source archives alone are not ready-to-run packages.

## Install and start

- Install and start Docker: [Docker Desktop](https://docs.docker.com/get-docker/) on Windows / macOS, Docker Engine with Compose v2 on Linux. Use Linux containers; Compose must support `up --wait`.
- Download `glaux-chat.zip` from [GitHub Releases](https://github.com/zhentai-sn/open-glaux/releases) once published, or get the offline bundle from a maintainer. Extract it.
- Start: double-click `start.cmd` on Windows or `start.command` on macOS; run `bash start.sh` in the extracted folder on Linux. The launcher imports bundled images if present, otherwise pulls prebuilt images, waits for healthy services and opens the browser.
- Open **Connection settings** and configure an Anthropic or OpenAI-compatible API endpoint, API key and model. For custom models, enter the context window and maximum output tokens the form asks for.

Notes:

- No Python, Node.js, Git, source compilation, GPU or specialized model installation is needed on the user's machine.
- Pulling images and calling remote models need network access. The offline bundle only skips the image download; remote models still need the network.
- The default address is `http://127.0.0.1:5173`, reachable only from this machine. A different browser or address needs the model connection configured again.
- Model requests originate inside Docker: `localhost` in an API endpoint means the container, not your host.

## Stop and data

- Stop: double-click `stop.cmd` on Windows or `stop.command` on macOS; run `bash stop.sh` on Linux. Closing the browser does not stop the services.
- Conversation history is stored in the `glaux_conversations` Docker volume and survives stopping or recreating containers. **To keep history, do not run `docker compose down -v` or delete the volume.**
- Model connection settings, including the API key, are stored in this browser's local storage. Clearing site data removes them; keys are never bundled into images.

## Troubleshooting

- Port 5173 in use: create `.env` next to `compose.yaml` with `GLAUX_PORT=5174`, then restart. A new port is a new site, so configure the model connection again.
- Startup fails: check that Docker is running, then run `docker compose logs --tail=100` in the extracted folder. A pull error can mean the images are unpublished, private, or unreachable.
- Report problems via [GitHub Issues](https://github.com/zhentai-sn/open-glaux/issues) with your OS, Docker version and error text. Remove API keys and private conversation content first.

## Maintainers: build and distribute

Build and run from the source repository:

```bash
docker compose -f compose.yaml -f docker/compose.build.yaml build
docker compose up -d --wait
```

Create an offline bundle (the only step that needs Python):

```bash
mkdir -p dist
docker save -o dist/images.tar ghcr.io/zhentai-sn/open-glaux-agent:0.2.0-chat.1 ghcr.io/zhentai-sn/open-glaux-web:0.2.0-chat.1
python3 scripts/release/package.py --images dist/images.tar --output dist/glaux-chat-offline.zip
```

- Small online launcher only: `python3 scripts/release/package.py`.
- Builds use lockfiles. The distribution runs only Web and the Node Agent Runtime; chat does not need the Python image backend, so it is not in the images.
- Image tags in `compose.yaml` do not mean those tags are published.
- Before distributing: publish both image tags, enable anonymous pulls, verify on a clean machine, then attach the ZIP to a release. Public release is a separate step.
- Image CPU architecture must match the target Docker environment; an amd64 build alone does not verify Apple Silicon / arm64.

## Local development

- `npm run dev` in `frontend/` and `agent-runtime/` defaults to the full edition with the stage and Atlas; it needs the Python backend running too.
- To debug the chat edition locally, set `VITE_GLAUX_EDITION=chat` for the frontend and `GLAUX_EDITION=chat` for the Agent; no Python backend is needed.
- Existing tests still cover the full edition; chat boundary tests cover the release restriction.
