#!/bin/bash
echo "🇰🇭 Starting AngkorSearch v2..."
mkdir -p storage/postgres storage/redis storage/html storage/index data/dict
docker compose down
docker compose up -d --build
echo ""
echo "✅ All services starting!"
echo "  🌐 Website : http://localhost"
echo "  🔌 API     : http://localhost:8080"
echo "  📊 Stats   : http://localhost:8080/stats"
echo "  🗄️  DB      : localhost:5432"
echo ""
echo "Watch crawler: docker compose logs -f crawler"
echo "Watch all:     docker compose logs -f"
echo "Stop:          docker compose down"