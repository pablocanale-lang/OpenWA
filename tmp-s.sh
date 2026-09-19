#!/bin/bash
cd /opt/openwa
KEY=$(docker compose exec -T openwa-api cat /app/data/.api-key | tr -d '\r\n')
curl -sS -H "X-API-Key: ${KEY}" http://127.0.0.1:2785/api/sessions
echo
docker compose logs --since 2m openwa-api | grep '{"timestamp"' | tail -8
