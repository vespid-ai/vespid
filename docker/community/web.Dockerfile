FROM node:24-alpine

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY docs ./docs
COPY scripts ./scripts
COPY README.md LICENSE NOTICE COPYRIGHT AGENTS.md ./

RUN pnpm install --frozen-lockfile
EXPOSE 3000
CMD ["pnpm", "--filter", "@vespid/web", "dev"]
