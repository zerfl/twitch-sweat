# Use a smaller Node.js (Alpine) base image
FROM node:20-alpine

# Install pnpm globally
RUN npm install -g pnpm

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# Copy package.json and pnpm-lock.yaml
COPY package.json pnpm-lock.yaml ./

# Install dependencies using pnpm
RUN pnpm install --frozen-lockfile

# Bundle app source
COPY . .

# Run the TypeScript file directly using tsx
CMD [ "node", "--import", "tsx", "src/index.ts" ]
