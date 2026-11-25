# SpendX: one container serves the API and the built website.
# Node 22.18+ runs the TypeScript sources directly (type stripping), so there is no separate compile step for the server.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Build the website, then drop the build-only tools (vite, typescript) from the final image.
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production
# Do not run as root.
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["npm", "start"]
