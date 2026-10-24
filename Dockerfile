# Build the Vite site, then run the Node server (game, shared world, Claude chat).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=80 DATA_DIR=/app/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY src ./src
COPY --from=build /app/dist ./dist
# shared edits and the chat log live here: mount a persistent volume at /app/data
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 80
CMD ["node", "server/index.js"]
