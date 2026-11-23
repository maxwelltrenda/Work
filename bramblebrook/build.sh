#!/usr/bin/env bash
# Builds the standalone live site (public/) from game.html, the Artifact source.
# game.html has no <html>/<head> wrapper because the Artifact publisher adds one;
# the live site needs its own.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p public
{
  printf '<!doctype html>\n<html lang="en">\n<head>\n'
  printf '<meta charset="utf-8">\n'
  printf '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
  printf '<meta name="theme-color" content="#2D6838">\n'
  printf '<meta name="description" content="A cozy, menu-based farming game. Grow crops, explore, fish, craft and help the people of Bramblebrook.">\n'
  printf '<link rel="manifest" href="manifest.webmanifest">\n'
  printf '<link rel="icon" href="icon.svg" type="image/svg+xml">\n'
  printf '<link rel="apple-touch-icon" href="icon-180.png">\n'
  printf '<meta name="apple-mobile-web-app-capable" content="yes">\n'
  printf '<meta name="apple-mobile-web-app-title" content="Bramblebrook">\n'
  printf '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%%}[hidden]{display:none!important}</style>\n'
  printf '</head>\n<body>\n'
  cat game.html
  printf '\n</body>\n</html>\n'
} > public/index.html
cp assets/icon.svg assets/manifest.webmanifest public/
cp assets/icon-180.png assets/icon-192.png assets/icon-512.png public/ 2>/dev/null || true
echo "Built public/index.html"
