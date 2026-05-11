FROM node:20

# Set working directory
WORKDIR /app

# Copy root package files
COPY package.json package-lock.json* ./

# Install root dependencies (including sqlite3 and backend packages)
RUN npm install

# Copy all source files
COPY . .

# Build the frontend (runs 'cd frontend && npm install && npm run build')
RUN npm run build

# Expose port
EXPOSE 5001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:5001/api/price', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start application
CMD ["node", "backend/server.js"]
