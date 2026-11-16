FROM node:24.22.3-alpine3.24

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js questions.json ./
COPY src ./src
COPY public ./public
COPY audio ./audio

USER node
EXPOSE 3000
CMD ["node", "server.js"]
