FROM oven/bun:1.2-alpine

WORKDIR /app

COPY package.json bun.lockb* bun.lock* ./
RUN bun install --frozen-lockfile || bun install

COPY . .

# Jalankan sebagai user non-root (image oven/bun sudah menyediakan user 'bun').
RUN chown -R bun:bun /app
USER bun

EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]

