# nginx/ — Production NGINX Reverse Proxy

## What This Directory Is
NGINX configuration for production deployment. Routes traffic to the FastAPI backend
and serves the React frontend. Critical for WebSocket support.

## Files
```
nginx/
└── nginx.conf    # Single config file — all server blocks here
```

## The Most Critical Rule: WebSocket Upgrade Headers
Without these headers, WebSocket connections will fail in production:

```nginx
location /ws/ {
    proxy_pass http://backend:8000;
    proxy_http_version 1.1;           # Required for WS

    proxy_set_header Upgrade $http_upgrade;      # Required for WS
    proxy_set_header Connection "upgrade";        # Required for WS

    proxy_connect_timeout 7d;   # WS connections are long-lived
    proxy_send_timeout 7d;
    proxy_read_timeout 7d;
}
```

Without `proxy_http_version 1.1` and the Upgrade/Connection headers, NGINX will
close WebSocket connections after 60 seconds (default proxy timeout).

## Port Map
```
Client → :443 (HTTPS) → NGINX → :8000 (FastAPI backend)
                               → /static (React build files)
```

## What Does NOT Go Here
- Backend Python code → `app/`
- Frontend code → `frontend/`
- Docker compose → `docker-compose.yml` (root) or `deploy/`
