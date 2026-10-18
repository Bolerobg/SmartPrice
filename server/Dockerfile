# SmartPrice API — production образ
#
# ВАЖНО (18.10.2026): базата е Debian (`node:22-slim`), НЕ Alpine.
# Защо: скраперът вече може да отваря страници с ИСТИНСКИ браузър — големите
# магазини (technomarket.bg, technopolis.bg, bauhaus.bg…) връщат HTML без цени,
# а цените идват чак след като JavaScript-ът се изпълни. Playwright-овият Chromium
# е компилиран за glibc и на Alpine (musl) не тръгва, затова тук ползваме
# Chromium от хранилището на Debian. Всичките етапи са на една и съща база —
# иначе native модулите (sharp) се компилират за musl и не работят после.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# chromium      — истинският браузър за сайтове, които се рисуват с JavaScript
# tini          — правилно спиране на процесите (PID 1)
# fontconfig + fonts-dejavu — текстът в SVG картата „Спестих X €“ (кирилица)
# ca-certificates — HTTPS от браузъра
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium tini fontconfig fonts-dejavu-core ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data/uploads
ENV CHROMIUM_PATH=/usr/bin/chromium
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
# Наръчникът на Ценко (AI съветникът) — чете се при самообучение. Ако го няма,
# Ценко обновява само живите факти, но губи обясненията на екраните.
COPY knowledge ./knowledge
EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
