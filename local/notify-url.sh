#!/bin/sh
# Pyet Cloudflare Tunnel për adresën publike, pret derisa faqja të hapet, pastaj e dërgon linkun
# (ntfy.sh dhe/ose Telegram) dhe e shkruan në OUT_FILE. Dërgon sërish vetëm kur linku ndryshon.
METRICS="${TUNNEL_METRICS:-http://tunnel:2000}"
OUT="${OUT_FILE:-/out/CURRENT_LINK.txt}"
NTFY_SERVER="${NTFY_SERVER:-https://ntfy.sh}"
POLL="${POLL_SECONDS:-15}"
WAIT_TRIES="${WAIT_TRIES:-60}"

last=""
[ -f "$OUT" ] && last="$(head -n1 "$OUT" 2>/dev/null)"

send() {
  url="$1"; note="$2"
  msg="365sim: $url$note"
  if [ -n "${NTFY_TOPIC:-}" ]; then
    curl -fsS -m 20 -H "Title: 365sim link" -H "Click: $url" -d "$msg" "$NTFY_SERVER/$NTFY_TOPIC" >/dev/null \
      && echo "[notify] ntfy OK" || echo "[notify] ntfy dështoi"
  fi
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -fsS -m 20 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=$msg" >/dev/null \
      && echo "[notify] Telegram OK" || echo "[notify] Telegram dështoi"
  fi
  [ -z "${NTFY_TOPIC:-}" ] && [ -z "${TELEGRAM_BOT_TOKEN:-}" ] && echo "[notify] asnjë kanal i vendosur; linku është vetëm në $OUT"
}

while true; do
  host="$(curl -fsS -m 5 "$METRICS/quicktunnel" 2>/dev/null | sed -n 's/.*"hostname"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if [ -n "$host" ]; then
    url="https://$host"
    if [ "$url" != "$last" ]; then
      base="${CHECK_BASE:-$url}"
      ok=""; i=0
      while [ "$i" -lt "$WAIT_TRIES" ]; do
        if curl -fsS -m 8 -o /dev/null "$base/api/health"; then ok=1; break; fi
        i=$((i+1)); sleep 3
      done
      mkdir -p "$(dirname "$OUT")"
      printf '%s\n' "$url" > "$OUT"
      if [ -n "$ok" ]; then send "$url" ""; else send "$url" " (faqja po ngrihet, provo pas pak)"; fi
      last="$url"
      echo "[notify] linku: $url"
    fi
  fi
  sleep "$POLL"
done
