FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools for canvas native dependencies if required
RUN apk add --no-co-cache python3 make g++ cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-co-cache cairo pango jpeg giflib librsvg

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

CMD ["node", "dist/index.js"]
