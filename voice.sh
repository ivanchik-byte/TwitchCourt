#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
case "${1:-}" in
    silero|piper) engine=$1 ;;
    *) printf 'Подготовка голоса: ./voice.sh silero или ./voice.sh piper\n'; exit 1 ;;
esac
python3 -m venv .venv-tts
python=.venv-tts/bin/python
if [[ "$engine" == silero ]]; then
    "$python" -m pip install torch --index-url https://download.pytorch.org/whl/cpu
    "$python" -m pip install numpy scipy
    printf '\nSilero подготовлен. В пульте нажмите «Запустить Silero». При первом запуске загрузится модель.\n'
else
    "$python" -m pip install piper-tts
    mkdir -p models
    voice=${2:-ru_RU-irina-medium}
    case "$voice" in ru_RU-irina-medium|ru_RU-dmitri-medium|ru_RU-ruslan-medium|ru_RU-denis-medium) ;; *) printf 'Неизвестный голос Piper. Доступны ru_RU-irina-medium, ru_RU-dmitri-medium, ru_RU-ruslan-medium, ru_RU-denis-medium.\n' >&2; exit 1 ;; esac
    "$python" -m piper.download_voices --data-dir models "$voice"
    printf '\nPiper подготовлен. В настройках голоса нажмите «Подставить стандартные пути».\n'
fi
