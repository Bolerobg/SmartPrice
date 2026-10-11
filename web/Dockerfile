# ============================================================================
# SmartPrice — web приложение (Expo export) + nginx, който проксира API-то.
# Всичко на един домейн: smart.lookthis.online
# ============================================================================

# --- Етап 1: билд на Expo web ---
FROM node:22-alpine AS build
WORKDIR /app

# Публичният адрес се вгражда в билда (Expo inlines EXPO_PUBLIC_* при export)
ARG EXPO_PUBLIC_API_URL=https://smart.lookthis.online
ARG EXPO_PUBLIC_DEEP_LINK_SCHEME=smartprice
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
ENV EXPO_PUBLIC_DEEP_LINK_SCHEME=$EXPO_PUBLIC_DEEP_LINK_SCHEME
ENV CI=1

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npx expo export --platform web --output-dir /out

# +html.tsx не се прилага при output:'single' — коригираме готовия index.html
# (viewport за телефон + CSS, който спира разтягането на страницата)
RUN node web/fix-index-html.mjs /out/index.html

# --- Етап 2: nginx ---
FROM nginx:alpine AS runtime
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /out /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
