# The router image, built from its `pnpm deploy` folder: its compiled code and production
# dependencies. Settings come from the environment; nothing here is specific to an environment.
FROM node:24.22.1-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node . .
USER node
CMD ["node", "--enable-source-maps", "--import", "newrelic/esm-loader.mjs", "-r", "newrelic", "dist/index.js"]
