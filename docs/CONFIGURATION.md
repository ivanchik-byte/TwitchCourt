# Полное руководство по конфигурации Stream Tribunal

Исчерпывающее руководство по настройке параметров `config.yaml`, переменным окружения, переопределению секретов и правилам разметки промптов.

---

## 1. Структура файлов конфигурации

В проекте используется два файла конфигурации:
* `config.default.yaml`: эталонный публичный шаблон с комментариями и подсказками по каждому полю. Отслеживается в git.
* `config.yaml`: ваш локальный рабочий файл настроек. В нем хранятся реальные токены, пароли и локальный черный список. Файл добавлен в `.gitignore` и никогда не попадает в репозиторий.

При первом запуске скопируйте шаблон:
```bash
cp config.default.yaml config.yaml
```

Большинство параметров можно менять на лету прямо через веб-интерфейс пульта (`http://localhost:3236`), изменения сохраняются в `config.yaml` автоматически без перезапуска процесса.

---

## 2. Раздел server (Параметры веб-сервера)

```yaml
server:
  host: "127.0.0.1"
  port: 3236
  secret: ""
```

* `host` (строка): сетевой интерфейс для прослушивания входящих подключений. По умолчанию `127.0.0.1` (доступ только с локальной машины). Для доступа из локальной сети укажите `0.0.0.0`.
* `port` (целое число, по умолчанию 3236, переменная окружения `PORT`): порт веб-сервера пульта и оверлея.
* `secret` (строка, переменная окружения `TRIBUNAL_SECRET`): секретный ключ доступа. Защищает административные API эндпоинты, смену настроек и запуск дел. Если задан, доступ к пульту и WebSocket оверлея требует передачи заголовка `X-Tribunal-Secret` или параметра запроса `?secret=`. Если вы открываете порт наружу, ключ обязателен: без него сервер на внешнем интерфейсе откажется стартовать.

---

## 3. Раздел ai (Языковая модель и мозг судьи)

```yaml
ai:
  provider: "groq"
  api_key: ""
  model: "llama-3.3-70b-versatile"
  temperature: 0.85
  stream: true
  base_url: ""
  extra_body: {}
```

* `provider`: предустановленный провайдер (`groq`, `cerebras`, `ollama` или произвольное имя).
* `api_key` (переменные `GROQ_API_KEY`, `CEREBRAS_API_KEY`): ключ доступа к API. Без ключа и без `base_url` суд не стартует — автономного режима без нейросети нет.
* `model`: название языковой модели. Для прямых эфиров критически важна низкая задержка первого токена (рекомендуется `llama-3.3-70b-versatile` на Groq или Cerebras).
* `temperature`: степень вариативности ответов (по умолчанию 0.85).
* `stream`: включение потоковой передачи токенов по протоколу Server-Sent Events (SSE). Рекомендуется `true`.
* `base_url`: адрес любого OpenAI-совместимого эндпоинта (например, `https://llm.onerouter.pro/v1` или `http://localhost:11434/v1`). Если поле заполнено, оно имеет приоритет над встроенными пресетами провайдеров.
* `extra_body`: произвольный словарь JSON, который подмешивается в корень запроса к LLM. Используется для передачи служебных параметров маршрутизации в роутерах вроде OneRouter или OpenRouter (например, `extra_body: {provider: {service_tier: standard}}`).

---

## 4. Раздел tts (Звуковой тракт и синтез речи)

```yaml
tts:
  enabled: true
  engine: "edge"
  voice: "ru-RU-SvetlanaNeural"
  rate: "+0%"
  volume: "+0%"
  pitch: "+0Hz"
  auto_fallback: true
  judge_voice: "ru-RU-SvetlanaNeural"
  judge_rate: "-10%"
  silero_url: "http://127.0.0.1:7892"
  silero_judge: "kseniya"
  piper_binary: ""
  model_path: "models/ru_irina.onnx"
  config_path: "models/ru_irina.onnx.json"
  speaker_id: 0
  speed: 1.15
```

* `enabled`: глобальный выключатель звукового тракта.
* `engine`: основной движок синтеза (`edge`, `silero`, `piper`).
* `auto_fallback`: автоматическое переключение на локальный синтез при сетевых сбоях Edge TTS.
* `silero_url` и `silero_judge`: адрес локального sidecar-сервера Silero и имя голоса (по умолчанию `kseniya`).
* **Правило ударений для Silero**: Silero поддерживает расстановку ударений знаком плюс перед ударной гласной (`вин+овен`, `в+аша честь`, `казн+ить`). Другие движки этот знак игнорируют.

---

## 5. Раздел courtroom (Игровые тайминги и колоды)

```yaml
courtroom:
  theme: "ace_attorney"
  judge_name: "Судья"
  judge_style: "strict"
  defense_sec: 20
  testimony_sec: 25
  sue_threshold: 5
  sue_window_sec: 600
  articles: []
  punishments: []
  standby_indictment: "Суд разбирает бумаги. Заседание продолжается!"
  standby_deliberation: "Суд удаляется на совещание."
  standby_objection: "Протест принят. Суд продолжает!"
  silent_defense: ""
  witness_intro: ""
  witness_outro: ""
  empty_testimony: ""
  bribe_twist: ""
  undecided_twist: ""
  witness_line: ""
  testimony_prefix: ""
  defense_prefix: ""
  snitch_prefix: ""
  penalty_timeout: ""
  penalty_pardon: ""
  penalty_ban: ""
  penalty_prefix: ""
  cases_file: "cases.yaml"
  cases_gen:
    enabled: true
    batch: 5
    low_mark: 3
```

* `defense_sec`: окно защиты стримера в секундах (клампится в диапазон от 5 до 120 секунд, по умолчанию 20).
* `testimony_sec`: окно ответов подсудимого в чате (клампится от 5 до 120 секунд, по умолчанию 25).
* `sue_threshold` и `sue_window_sec`: количество голосов зрителей по команде `!sue` и размер временного окна для суда над стримером.
* `articles`: список быстрых статей для кнопок в пульте управления.
* `punishments`: колода шуточных наказаний для стримера (тянется при виновном вердикте в суде над стримером).
* `bribe_twist`: специальная фраза, которая добавляется к вердикту только при оправдании со взяткой.
* `undecided_twist`: фраза, добавляемая при оправдании в случае технического сбоя или отсутствия решения модели.
* `cases_gen`: параметры фоновой автогенерации судебных дел, когда несыгранных дел в колоде остается меньше `low_mark`.

---

## 6. Раздел safety (Безопасность трансляции)

```yaml
safety:
  filter_enabled: true
  custom_blacklist: []
  panic_hotkey: "f12"
  ban_confirm: true
  bribe_words: []
```

* `filter_enabled`: включает проверку текста на стоп-слова перед озвучкой и выводом в титры.
* `custom_blacklist`: массив запрещенных слов (хранится только в локальном `config.yaml`).
* `panic_hotkey`: клавиша паники (поддерживаются значения `f12`, `f9`, `escape`, `p`).
* `ban_confirm`: при значении `true` исключает автоматическую блокировку в Twitch API. Реальный бан применяется только вручную через пульт.
* `bribe_words`: список корней слов в донатах (например, `["взятк", "подмаж"]`), которые кладут взятку на стол судьи.

---

## 7. Раздел twitch (Интеграция с Twitch)

```yaml
twitch:
  channel: ""
  nick: "tribunal_bot"
  token: ""
  client_id: ""
  broadcaster_id: ""
  moderator_id: ""
```

* `channel`: имя вашего канала Twitch (в нижнем регистре).
* `nick`: логин бота.
* `token` (переменная `TWITCH_TOKEN`): OAuth токен бота со скоупами `chat:read` и `chat:edit`.
* `client_id`, `broadcaster_id`, `moderator_id`: требуются для работы режима Unban-суда со скоупами `moderator:read:unban_requests` и `moderator:manage:unban_requests`.

---

## 8. Раздел donations (Платформы донатов)

```yaml
donations:
  token: ""
  default_min: 100
  platinum_min: 500
  streamer_trial_min: 0
  bribe_min: 0
  min_amounts:
    RUB: 100
    USD: 2
    EUR: 2
    BITS: 200
  donationalerts:
    enabled: true
    token: ""
  donatepay:
    enabled: true
    api_key: ""
  twitch_bits:
    enabled: true
```

* `donationalerts.token`: токен виджета DonationAlerts (из ссылки на виджет оповещений после `?token=`).
* `donatepay.api_key`: API-ключ с личной страницы DonatePay.
* `twitch_bits.enabled`: прием Bits через EventSub WebSocket.
* `min_amounts`: минимальные суммы донатов для запуска дела по каждой валюте. Донаты ниже порога просто сохраняются в память суда.
* `platinum_min`: сумма, запускающая суд над стримером.
* `bribe_min`: сумма, начиная с которой донат воспринимается как взятка даже без ключевых слов.
