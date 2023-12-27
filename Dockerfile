# Use a smaller Node.js (Alpine) base image
FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies including 'tsx' for running TypeScript directly
RUN npm install

# Bundle app source
COPY . .

# Run the TypeScript file directly using tsx
CMD [ "npx", "tsx", "src/index.ts" ]
