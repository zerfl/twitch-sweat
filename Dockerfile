FROM node:20-alpine AS base
RUN npm install -g pnpm
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml ./
COPY drizzle ./drizzle
COPY src ./src
COPY tsconfig.json ./tsconfig.json
COPY tsconfig.eslint.json ./tsconfig.eslint.json
COPY environment.d.ts ./environment.d.ts
CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]
