# Stage 1: Build the TypeScript application
FROM node:20 AS builder

WORKDIR /app

COPY package.json yarn.lock tsconfig.json ./
RUN yarn install --frozen-lockfile

COPY src ./src
RUN yarn build

# Stage 2: Run the compiled JavaScript application
FROM node:20 AS runner

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production

COPY --from=builder /app/dist ./dist
# Copy direction.json so it is resolved at runtime
COPY src/direction.json ./src/direction.json

EXPOSE 3000

ENV NODE_ENV production

# Run the compiled production JavaScript
CMD ["node", "dist/index.js"]
