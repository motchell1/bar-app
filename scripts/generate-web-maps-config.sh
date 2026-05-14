#!/usr/bin/env bash
set -euo pipefail

: "${GOOGLE_MAPS_WEB_API_KEY:?GOOGLE_MAPS_WEB_API_KEY must be set}"

cat > web/js/maps-config.js <<EOC
window.GOOGLE_MAPS_WEB_API_KEY = '${GOOGLE_MAPS_WEB_API_KEY}';
EOC

echo "Generated web/js/maps-config.js from GOOGLE_MAPS_WEB_API_KEY"
