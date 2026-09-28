FROM node:22-alpine
WORKDIR /app
COPY package.json server.js xlsx.js ./
COPY public ./public
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_FILE=/data/data.json
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
