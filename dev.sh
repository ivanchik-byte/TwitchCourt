#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

for tool in go npm curl setsid flock; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        printf 'Не найдена команда %s. Для запуска нужны Go, Node.js/npm, curl и util-linux.\n' "$tool" >&2
        exit 1
    fi
done

mkdir -p .infoslop/dev
exec 9>.infoslop/dev/launch.lock
if ! flock -n 9; then
    printf 'TwitchCourt уже запущен через dev.sh. Останови его в прежнем терминале: Ctrl+C.\n' >&2
    exit 1
fi

for port in 3236 5173; do
    if (: >"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
        printf 'Порт %s занят. Останови прежний сервер перед запуском.\n' "$port" >&2
        exit 1
    fi
done

if [[ ! -x web/frontend/node_modules/.bin/vite || ! -x web/frontend/node_modules/.bin/tsc || web/frontend/package-lock.json -nt web/frontend/node_modules/.package-lock.json ]]; then
    printf 'Устанавливаю зависимости интерфейса…\n'
    (cd web/frontend && npm ci --no-audit --no-fund) 9>&-
fi

sh web/build.sh 9>&-

processes=()
cleanup() {
    trap '' INT TERM
    for pid in "${processes[@]}"; do
        kill -TERM -- "-$pid" 2>/dev/null || true
    done
    for pid in "${processes[@]}"; do
        wait "$pid" 2>/dev/null || true
    done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'Запускаю сервер. Журнал: .infoslop/dev/server.log\n'
setsid go run ./cmd/server >.infoslop/dev/server.log 2>&1 9>&- &
server_pid=$!
processes+=("$server_pid")

ready=false
for ((attempt = 0; attempt < 120; attempt++)); do
    if ! kill -0 "$server_pid" 2>/dev/null; then
        printf 'Сервер остановился. Подробности: .infoslop/dev/server.log\n' >&2
        exit 1
    fi
    if curl --noproxy '*' --silent --output /dev/null --max-time 1 http://127.0.0.1:3236/api/status; then
        ready=true
        break
    fi
    sleep 0.5
done
if [[ "$ready" != true ]]; then
    printf 'Сервер не ответил на 127.0.0.1:3236. Проверь server.host/server.port в config.yaml и .infoslop/dev/server.log.\n' >&2
    exit 1
fi

printf '\nПульт: http://127.0.0.1:5173/\nСцена OBS: http://127.0.0.1:3236/overlay/\nОстановка: Ctrl+C. Изменения интерфейса появятся сразу; после правок Go или сцены перезапусти dev.sh.\n\n'
setsid npm --prefix web/frontend run dev -- --host 127.0.0.1 --port 5173 --strictPort --open 9>&- &
processes+=("$!")
wait -n "${processes[@]}"
