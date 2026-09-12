#!/bin/sh
# Installs or updates the live server on the Oracle box, next to the demo:
# checkout in /opt/llms-robot-arena, the systemd unit, the nginx site and
# the certificate. Run as ubuntu with sudo: sh deploy/live/deploy.sh
set -eu
REPO=/opt/llms-robot-arena
HOST=live.llms-robot-arena.sndesign.it
NODE=/usr/local/bin/node

if [ ! -d "$REPO/.git" ]; then
  sudo git clone --depth 1 https://github.com/nigrosimone/llms-robot-arena.git "$REPO"
fi
cd "$REPO"
sudo git fetch --depth 1 origin main
sudo git reset --hard origin/main
sudo env PATH="$(dirname "$NODE"):$PATH" npm ci --omit=dev --no-audit --no-fund
id arena >/dev/null 2>&1 || sudo useradd --system --home "$REPO" --shell /usr/sbin/nologin arena

sudo cp deploy/live/arena-live.service /etc/systemd/system/arena-live.service
sudo systemctl daemon-reload
sudo systemctl enable --now arena-live
sudo systemctl restart arena-live

# The certificate first, answering the challenge over plain http, then the full site.
if [ ! -e "/etc/letsencrypt/live/$HOST/fullchain.pem" ]; then
  sudo mkdir -p /var/www/certbot
  printf 'server {
    listen 80;
    listen [::]:80;
    server_name %s;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
}
' "$HOST" |
    sudo tee /etc/nginx/sites-available/arena-live >/dev/null
  sudo ln -sf /etc/nginx/sites-available/arena-live /etc/nginx/sites-enabled/arena-live
  sudo nginx -t && sudo systemctl reload nginx
  sudo certbot certonly --webroot -w /var/www/certbot -d "$HOST" --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring
fi
sudo cp deploy/live/nginx-live.conf /etc/nginx/sites-available/arena-live
sudo ln -sf /etc/nginx/sites-available/arena-live /etc/nginx/sites-enabled/arena-live
sudo nginx -t && sudo systemctl reload nginx

sleep 1
curl -fsS "https://$HOST/health" && echo
