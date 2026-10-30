# Build and test, then serve the single page with nginx. See "Hosting
# requirements" in the README; deploy/nginx.conf implements them.
FROM node:22-alpine AS build
WORKDIR /src
COPY . .
RUN npm test && npm run build

FROM nginx:1.30-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist/index.html /usr/share/nginx/html/index.html
