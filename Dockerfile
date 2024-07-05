# Use an official Node.js 20 runtime as a parent image
FROM node:20

# Create and set the working directory
RUN mkdir -p /home/node/rudder-github-app && chown -R node:node /home/node/rudder-github-app

# Set the working directory in the container
WORKDIR /home/node/rudder-github-app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install dependencies using npm ci
RUN npm ci --no-audit --cache .npm

# Copy the rest of the application code to the working directory
COPY . .

# Change ownership of the copied files to the node user
RUN chown -R node:node /home/node/rudder-github-app

# Switch to the node user
USER node

# Expose the port the app runs on
EXPOSE 3000

# Start the app using npm start
CMD ["npm", "start"]