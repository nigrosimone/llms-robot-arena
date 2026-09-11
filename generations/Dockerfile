# The harness runs here with a bare home: no operator CLAUDE.md, no other
# repository on disk, only the workspace mounted at /work and the credentials
# copied for the session. Build: docker build -t llms-robot-arena-gen generations
FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @anthropic-ai/claude-code @openai/codex
ENV CI=1
WORKDIR /work
