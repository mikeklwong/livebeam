FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY dist ./dist
COPY server ./server
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV HOST=0.0.0.0 PORT=4173
EXPOSE 4173
VOLUME ["/app/data"]
CMD ["node", "server/index.mjs"]
