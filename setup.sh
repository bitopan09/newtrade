#!/bin/bash

# Trading Bot Setup & Deployment Script

set -e

echo "🚀 Trading Bot Setup Script"
echo "================================"

# Check if .env exists
if [ ! -f .env ]; then
    echo "📋 Creating .env file from template..."
    cp .env.example .env
    echo "✅ .env created. Please edit it with your configuration."
    echo "   - EMAIL_USER: Your Gmail address"
    echo "   - EMAIL_PASSWORD: Gmail App Password"
    echo "   - NOTIFY_EMAIL: Where to receive notifications"
    exit 1
else
    echo "✅ .env file found"
fi

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 18+"
    exit 1
fi
echo "✅ Node.js $(node -v)"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm not found"
    exit 1
fi
echo "✅ npm $(npm -v)"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

echo ""
echo "📦 Installing frontend dependencies..."
cd frontend
npm install
cd ..

# Build frontend
echo ""
echo "🔨 Building frontend..."
npm run build

# Check Docker (optional)
if command -v docker &> /dev/null; then
    echo "✅ Docker found: $(docker --version)"
    echo ""
    read -p "Would you like to run with Docker? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🐳 Starting with Docker Compose..."
        docker-compose up -d
        echo "✅ Bot running in Docker!"
        echo "📊 Dashboard: http://localhost:5001"
        exit 0
    fi
fi

# Local startup
echo ""
echo "🎯 Starting Trading Bot..."
npm start
