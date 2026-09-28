#!/usr/bin/env bash
# Richtet die Kita-App auf einem gemieteten Server (Debian 12/13 oder Ubuntu 24.04) ein:
# App als Dienst, HTTPS mit automatischem Let's-Encrypt-Zertifikat (Caddy),
# Firewall und automatische Sicherheitsupdates.
#
# Aufruf im App-Ordner (als root):
#   bash deploy/server/install.sh                # Erstinstallation bzw. Update
#   bash deploy/server/install.sh --neue-codes   # Zugangscodes ändern
#
# Bei einem Update bleiben Codes, Daten und Domain erhalten.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOMAIN_FILE=/etc/kita-app.domain
CADDYFILE=/etc/caddy/Caddyfile

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mFehler: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Bitte als root starten (bzw. mit sudo davor)."
[ -f "$SRC_DIR/server.js" ] || fail "server.js nicht gefunden. Bitte das Skript aus dem App-Ordner heraus starten."

# ---------- 1. Domain ----------
domain="${DOMAIN:-}"
[ -n "$domain" ] || { [ -f "$DOMAIN_FILE" ] && domain="$(cat "$DOMAIN_FILE")"; } || true
if [ -z "$domain" ]; then
  say "Unter welcher Adresse soll die App erreichbar sein?"
  echo "Die Domain muss bereits auf diesen Server zeigen (siehe Anleitung), z. B. eltern.kita-sonnenschein.de"
  read -r -p "Domain (ohne https://): " domain
fi
domain="$(printf '%s' "$domain" | tr 'A-Z' 'a-z' | sed -e 's#^https\?://##' -e 's#/.*$##')"
[[ "$domain" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || fail "\"$domain\" ist keine gültige Domain."

# Zeigt die Domain wirklich auf diesen Server? Sonst scheitert das Zertifikat.
server_ips="$(hostname -I 2>/dev/null | xargs || true)"
domain_ips="$(getent ahosts "$domain" 2>/dev/null | awk '{print $1}' | sort -u | xargs || true)"
if [ -z "$domain_ips" ]; then
  fail "Die Domain $domain ist (noch) nicht eingerichtet. Bitte beim Domain-Anbieter einen A-Eintrag auf die IP dieses Servers setzen und 10–30 Minuten warten."
fi
match=""
for ip in $domain_ips; do
  for own in $server_ips; do [ "$ip" = "$own" ] && match=1; done
done
if [ -z "$match" ] && [ -z "${SKIP_DNS_CHECK:-}" ]; then
  fail "Die Domain $domain zeigt auf $domain_ips, dieser Server hat aber $server_ips. Bitte den A-Eintrag beim Domain-Anbieter prüfen (Änderungen brauchen manchmal bis zu einer Stunde)."
fi
echo "$domain" > "$DOMAIN_FILE"

apt-get update -q >/dev/null || fail "Paketquellen nicht erreichbar. Hat der Server Internet?"

# ---------- 2. App (gleiches Skript wie beim Raspberry Pi) ----------
# Die App lauscht nur intern; von außen geht es ausschließlich über Caddy (HTTPS).
KITA_SERVER_MODE=1 NAS_IP=127.0.0.1 LISTEN_HOST=127.0.0.1 bash "$SRC_DIR/deploy/raspberry-pi/install.sh" "$@"

# ---------- 3. HTTPS mit Caddy ----------
if ! command -v caddy >/dev/null; then
  say "Installiere Caddy (HTTPS) …"
  apt-get install -y -q caddy || fail "Caddy konnte nicht installiert werden."
fi
cat > "$CADDYFILE" <<EOF
# Kita-App – Caddy holt und erneuert das HTTPS-Zertifikat automatisch
$domain {
	encode gzip
	header Strict-Transport-Security "max-age=31536000"
	reverse_proxy 127.0.0.1:3000
}
EOF
caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1 || fail "Die Caddy-Konfiguration ist fehlerhaft."
systemctl enable caddy >/dev/null 2>&1
systemctl restart caddy

# ---------- 4. Firewall: nur SSH, HTTP und HTTPS ----------
say "Richte die Firewall ein …"
apt-get install -y -q ufw >/dev/null || fail "Firewall (ufw) konnte nicht installiert werden."
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

# ---------- 5. Automatische Sicherheitsupdates ----------
apt-get install -y -q unattended-upgrades >/dev/null || true
echo 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";' > /etc/apt/apt.conf.d/20auto-upgrades

# ---------- 6. Prüfen ----------
say "Warte auf das HTTPS-Zertifikat (bis zu 1 Minute) …"
ok=""
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null --max-time 5 "https://$domain/" 2>/dev/null; then ok=1; break; fi
  sleep 2
done

if [ -n "$ok" ]; then
  say "✅ Fertig! Die Kita-App ist online."
else
  say "⚠️  Die App läuft, aber HTTPS antwortet noch nicht."
  echo "Häufig braucht das Zertifikat nur etwas länger. In ein paar Minuten im Browser probieren."
  echo "Sonst hier nachsehen:  journalctl -u caddy -n 30 --no-pager"
fi
echo
echo "  Eltern:      https://$domain"
echo "  Verwaltung:  https://$domain/admin"
echo
echo "Nützliche Befehle:"
echo "  Protokoll der App:   journalctl -u kita-app -f"
echo "  Codes ändern:        bash deploy/server/install.sh --neue-codes"
echo "  Datensicherungen:    ls /var/lib/kita-app/backups"
