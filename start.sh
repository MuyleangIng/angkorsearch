#!/bin/bash
echo "Starting AngkorSearch v2.2..."

# Create all storage directories
mkdir -p storage/postgres storage/redis storage/html storage/index storage/ollama data/dict

# Fresh start — wipes DB so new schema applies cleanly
# Comment out these two lines if you want to keep existing data
echo "Resetting data for clean schema install..."
docker compose down -v 2>/dev/null || true

# Build and start all services
docker compose up -d --build

echo ""
echo "All services starting. Waiting for Ollama to be ready..."

# Wait up to 60s for Ollama health check
for i in $(seq 1 12); do
    if docker compose exec -T ollama curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
        echo "Ollama is ready."
        break
    fi
    echo "  Waiting for Ollama... ($i/12)"
    sleep 5
done

echo ""
echo "Services running:"
echo "  Website  : http://localhost"
echo "  API      : http://localhost:8080"
echo "  Stats    : http://localhost:8080/stats"
echo "  Admin    : http://localhost/admin"
echo "  Ollama   : http://localhost:11434"
echo "  DB       : localhost:5432"
echo ""
echo "The ollama-init container is pulling qwen2.5:3b (~2GB, first run takes a few minutes)."
echo "Watch model download: docker compose logs -f ollama-init"
echo ""
echo "Watch crawler:  docker compose logs -f crawler_1"
echo "Watch all:      docker compose logs -f"
echo "Stop:           docker compose down"
