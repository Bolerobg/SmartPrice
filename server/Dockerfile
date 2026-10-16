# SmartPrice API — production образ
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# fontconfig + DejaVu са нужни за текста в SVG картата „Спестих X €“ (кирилица).
RUN apk add --no-cache tini fontconfig ttf-dejavu && mkdir -p /data/uploads
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
# Наръчникът на Ценко (AI съветникът) — чете се при самообучение. Ако го няма,
# Ценко обновява само живите факти, но губи обясненията на екраните.
COPY knowledge ./knowledge
EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
