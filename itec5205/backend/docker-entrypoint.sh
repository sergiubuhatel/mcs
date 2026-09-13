#!/bin/sh
set -e

# Waitress (the WSGI app server) listens on localhost only; nginx is the
# container's public-facing web server and reverse-proxies to it.
export WAITRESS_HOST=127.0.0.1
export WAITRESS_PORT=8000
python wsgi.py &

exec nginx -g "daemon off;"
