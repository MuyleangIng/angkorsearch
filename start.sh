#!/bin/bash
# ============================================================
#  AngkorSearch — Start Everything
#  Usage: ./start.sh
# ============================================================

echo "🇰🇭 Starting AngkorSearch..."

# Create required local folders
mkdir -p data/html data/dict

# Copy Khmer dictionary
cp -n ../data/khmer_dict.txt data/dict/khmer_dict.txt 2>/dev/null || true

# Start all services
docker compose up -d --build

echo ""
echo "✅ AngkorSearch is starting!"
echo ""
echo "  🌐 Website:    http://localhost"
echo "  🔌 API:        http://localhost:8080"
echo "  🗄️  Database:   localhost:5432"
echo "  ⚡ Redis:      localhost:6379"
echo ""
echo "Watch logs:"
echo "  docker compose logs -f"
echo ""
echo "Stop everything:"
echo "  docker compose down"
