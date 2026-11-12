#!/bin/zsh
# Uruchamia server, client, mailer i rag. Jeśli już działają, najpierw je zatrzymuje.

cd "$(dirname "$0")"
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"

# 3001 server, 5173 client, 3002 mailer, 3003 rag
for port in 3001 5173 3002 3003; do
  pids=$(lsof -ti tcp:$port -sTCP:LISTEN)
  if [[ -n "$pids" ]]; then
    echo "Zatrzymuję proces na porcie $port"
    kill $pids
  fi
done
sleep 1

bunx concurrently -n server,client,mailer,rag -c blue,green,yellow,magenta \
  "bun run dev:server" \
  "bun run dev:client" \
  "bun run dev:mailer" \
  "bun run dev:rag"
