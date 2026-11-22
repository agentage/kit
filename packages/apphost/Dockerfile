# The app host program, built from this repo's own tree (context = repo root): the kit, apphost and
# the shell never come from npm. Build: docker build -f packages/apphost/Dockerfile .
FROM node:26-alpine AS build
WORKDIR /src
COPY . .
RUN npm ci --no-audit --no-fund && npm run build
# The runtime tree from the workspace lockfile: apphost's production deps, workspace packages linked.
RUN rm -rf node_modules packages/*/node_modules packages/*/src \
  && npm ci --omit=dev --omit=peer --omit=optional --ignore-scripts --no-audit --no-fund -w @agentage/apphost
RUN node packages/apphost/check-install.mjs /src

FROM node:26-alpine
ARG COMMIT_SHA=unknown
ARG BUILD_TIME=unknown
ARG VERSION=0.0.0
ENV NODE_ENV=production COMMIT_SHA=$COMMIT_SHA BUILD_TIME=$BUILD_TIME VERSION=$VERSION PORT=3000
LABEL org.opencontainers.image.source=https://github.com/agentage/kit \
  org.opencontainers.image.revision=$COMMIT_SHA org.opencontainers.image.version=$VERSION
WORKDIR /app
COPY --from=build /src/package.json /src/package-lock.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/packages ./packages
USER node
EXPOSE 3000
# The drain (5 s, SIGTERM) ends inside the 10 s stop grace of the stack.
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# No CMD: a stack runs the image with no command, and `docker run IMAGE --check DIR` passes the flag.
ENTRYPOINT ["/app/node_modules/.bin/agentage-apphost-cloud"]
