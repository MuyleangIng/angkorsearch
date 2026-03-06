#!/bin/bash
# Seed key Wikipedia articles directly into the DB via Wikipedia REST API
# This bypasses the crawler for important pages that need to be indexed immediately

DB="docker compose exec -T postgres psql -U angkor -d angkorsearch"

echo "Seeding Cambodia + Anime Wikipedia articles..."

seed_page() {
  local TITLE="$1"
  local ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$TITLE'))")
  local URL="https://en.wikipedia.org/wiki/${ENCODED// /_}"

  # Use Wikipedia REST summary API — returns clean JSON, no JS rendering needed
  local JSON=$(curl -s --max-time 10 \
    "https://en.wikipedia.org/api/rest_v1/page/summary/${ENCODED// /_}")

  local TITLE_TEXT=$(echo "$JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('title',''))" 2>/dev/null)
  local EXTRACT=$(echo "$JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('extract','')[:5000])" 2>/dev/null)
  local DESC=$(echo "$JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('description','')[:300])" 2>/dev/null)
  local THUMB=$(echo "$JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); t=d.get('thumbnail',{}); print(t.get('source',''))" 2>/dev/null)

  if [ -z "$EXTRACT" ] || [ "$EXTRACT" = "None" ]; then
    echo "  SKIP (no content): $TITLE"
    return
  fi

  # Detect language
  local LANG="en"

  # Escape for SQL using python
  local SQL_URL=$(python3 -c "import sys; s='$URL'; print(s.replace(\"'\",\"''\"))" 2>/dev/null)
  local SQL_TITLE=$(python3 -c "
t = '''$TITLE_TEXT'''
print(t.replace(\"'\", \"''\"))
" 2>/dev/null)
  local SQL_DESC=$(python3 -c "
import sys
t = '''$DESC'''
print(t.replace(\"'\", \"''\").replace(chr(10),' ').replace(chr(13),' '))
" 2>/dev/null)
  local SQL_CONTENT=$(python3 -c "
import sys
t = '''$EXTRACT'''
t = t.replace(\"'\", \"''\").replace(chr(10),' ').replace(chr(13),' ')
print(t[:5000])
" 2>/dev/null)

  $DB -c "
INSERT INTO pages (url, domain, title, description, language, content, word_count, page_type)
VALUES (
  '${SQL_URL}',
  'en.wikipedia.org',
  '${SQL_TITLE}',
  '${SQL_DESC}',
  '${LANG}',
  '${SQL_CONTENT}',
  $(echo "$EXTRACT" | wc -w),
  'web'
) ON CONFLICT (url) DO UPDATE SET
  title=EXCLUDED.title,
  description=EXCLUDED.description,
  content=EXCLUDED.content,
  updated_at=NOW();
" > /dev/null 2>&1

  echo "  OK: $TITLE_TEXT"
}

echo ""
echo "== Cambodia History & Culture =="
seed_page "Cambodia"
seed_page "Angkor Wat"
seed_page "Angkor Thom"
seed_page "Angkor"
seed_page "Khmer Empire"
seed_page "Phnom Penh"
seed_page "Siem Reap"
seed_page "Khmer people"
seed_page "Khmer language"
seed_page "Khmer Rouge"
seed_page "Cambodian genocide"
seed_page "Bayon"
seed_page "Tonle Sap"
seed_page "Mekong"
seed_page "Apsara"
seed_page "Cambodian cuisine"
seed_page "Cambodian music"
seed_page "Cambodian classical dance"
seed_page "Royal Palace, Phnom Penh"
seed_page "Cambodian economy"
seed_page "Buddhism in Cambodia"
seed_page "Preah Vihear Temple"
seed_page "Ta Prohm"
seed_page "Bantey Srei"
seed_page "Cambodian New Year"

echo ""
echo "== Popular Anime =="
seed_page "One Piece"
seed_page "Naruto"
seed_page "Attack on Titan"
seed_page "Demon Slayer: Kimetsu no Yaiba"
seed_page "Dragon Ball Z"
seed_page "Death Note"
seed_page "Fullmetal Alchemist: Brotherhood"
seed_page "Bleach (manga)"
seed_page "Jujutsu Kaisen"
seed_page "My Hero Academia"
seed_page "Sword Art Online"
seed_page "Tokyo Ghoul"
seed_page "Hunter x Hunter"
seed_page "Fairy Tail"
seed_page "Black Clover"
seed_page "Overlord (anime)"
seed_page "Re:Zero − Starting Life in Another World"
seed_page "That Time I Got Reincarnated as a Slime"
seed_page "Solo Leveling"
seed_page "Vinland Saga"

echo ""
echo "Done! Run: docker compose exec postgres psql -U angkor -d angkorsearch -c 'SELECT COUNT(*) FROM pages WHERE domain='"'"'en.wikipedia.org'"'"';'"
