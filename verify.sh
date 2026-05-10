#!/bin/bash

# Quick Start Verification Script

echo "🔍 Trading Bot - Quick Verification"
echo "===================================="
echo ""

# Check Node.js
if command -v node &> /dev/null; then
    echo "✅ Node.js: $(node -v)"
else
    echo "❌ Node.js: Not installed"
fi

# Check npm
if command -v npm &> /dev/null; then
    echo "✅ npm: $(npm -v)"
else
    echo "❌ npm: Not installed"
fi

# Check Docker
if command -v docker &> /dev/null; then
    echo "✅ Docker: $(docker --version | cut -d' ' -f3)"
else
    echo "⚠️  Docker: Not installed (optional)"
fi

# Check .env
if [ -f .env ]; then
    echo "✅ .env file: Found"
    if grep -q "EMAIL_USER" .env; then
        echo "✅ EMAIL_USER: Configured"
    else
        echo "⚠️  EMAIL_USER: Not configured"
    fi
else
    echo "❌ .env file: Not found"
    echo "   Run: cp .env.example .env"
fi

# Check key files
echo ""
echo "📁 Key Files:"
for file in backend/server.js backend/emailService.js frontend/src/App.css frontend/src/utils/timeFormatter.js docker-compose.yml Dockerfile DEPLOYMENT.md README.md setup.sh .env.example
do
    if [ -f "$file" ]; then
        echo "✅ $file"
    else
        echo "❌ $file"
    fi
done

echo ""
echo "🎯 Next Steps:"
echo "1. Copy .env template: cp .env.example .env"
echo "2. Edit .env with your email configuration"
echo "3. Start bot: npm start"
echo "4. Open dashboard: http://localhost:5001"
echo ""
echo "📧 For email setup, see DEPLOYMENT.md"
echo "🐳 For Docker: docker-compose up -d"
echo ""
