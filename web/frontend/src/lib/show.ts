export type CourtMode = 'viewer' | 'streamer' | 'unban'

export interface ShowCase {
  id: string
  title: string
  crime: string
  context: string
  details?: string
  defense_example?: string
  tags?: string[]
  source?: string
  used?: boolean
  hint?: string
  source_url?: string
  dilemma?: string
  question?: string
  exhibits?: { title: string; text: string }[]
}

export interface ShowStatus {
  ai_live: boolean
  tts_beep: boolean
  tts_engine: string
  tts_enabled: boolean
  twitch_configured: boolean
  streamer_name: string
  panic_hotkey: string
}

export const modes = {
  viewer: { name: 'Суд над зрителем', short: 'Зритель', role: 'Вы адвокат', description: 'Зритель на скамье. Найдите оправдание, в которое никто не верил.', floor: 'Защищайте зрителя. Судья ответит на ваш аргумент.' },
  streamer: { name: 'Суд над стримером', short: 'Стример', role: 'Вы подсудимый', description: 'Чат собрал улики. Теперь объясняться придётся вам.', floor: 'Ответьте прокурору. У вас есть право на последнее слово.' },
  unban: { name: 'Разбан-суд', short: 'Апелляция', role: 'Вы обвинитель', description: 'ИИ защищает участника. Вы решаете, заслуживает ли он второго шанса.', floor: 'Объясните причину бана и ответьте адвокату.' },
}

export const starterCases: Record<Exclude<CourtMode, 'unban'>, ShowCase[]> = {
  viewer: [
    { id: 'night-shift', title: 'Четыре часа до сна', crime: 'Объявил, что идёт спать, и ещё четыре часа давал советы в чате.', context: 'Учебная улика: «Всё, спокойной ночи» в 23:41. Затем 47 сообщений. Последнее: «Там же справа был» в 03:47.', hint: 'Может быть, он нёс ночную вахту и спасал прохождение?' },
    { id: 'backseat', title: 'Эксперт без лицензии', crime: 'Объяснял стримеру, как проходить игру, которую сам не запускал.', context: 'Учебная улика: «Я видел прохождение, там легко». Время в игре: 0 минут.', hint: 'Обязан ли тренер сам выходить на поле?' },
    { id: 'audio-inspector', title: 'Внеплановая проверка звука', crime: 'Написал «звука нет» сразу после удачной шутки стримера.', context: 'Учебная улика: после просьбы проверить наушники написал «теперь есть». Настройки звука никто не менял.', hint: 'Он проверял оборудование или спасал репутацию ведущего?' },
    { id: 'lurker', title: 'Свидетель из тени', crime: 'Три месяца молчал в чате и впервые написал, чтобы исправить произношение слова.', context: 'Учебная улика: первое сообщение за 90 дней: «Вообще-то звонИт».', hint: 'Молчание могло быть испытательным сроком редактора.' },
    { id: 'prediction', title: 'Прогноз с опозданием', crime: 'Написал «я так и знал» после того, как стример уже проиграл.', context: 'Учебная улика: до поражения предсказывал лёгкую победу. После заявил, что это был сарказм.', hint: 'Потребуйте доказать, что сарказм не был засекречен.' },
  ],
  streamer: [
    { id: 'last-game', title: 'Седьмая последняя катка', crime: 'Обещал последнюю катку. Это было семь каток назад.', context: 'Учебная улика: семь объявлений «эта точно последняя» за один вечер.', hint: 'Попробуйте объяснить суду, где заканчивается одна длинная катка.' },
    { id: 'five-minutes', title: 'Перерыв на сорок минут', crime: 'Ушёл за чаем на пять минут и пропустил половину собственного эфира.', context: 'Учебная улика: таймер «скоро вернусь» успел закончиться три раза.', hint: 'Докажите, что чай требовал длительного сопровождения.' },
    { id: 'horror', title: 'Хоррор в сельском хозяйстве', crime: 'Обещал вечер хорроров, а запустил ферму.', context: 'Учебная улика: вместо монстра зрителям два часа показывали морковь.', hint: 'Засуха, кредиты и неурожай тоже способны напугать.' },
  ],
}

export const phaseLabels: Record<string, string> = {
  idle: 'Готовимся к заседанию', indictment: 'Открытие дела', testimony: 'Показания',
  defense: 'Ваше слово', objection: 'Ответ суда', deliberation: 'Суд совещается', verdict: 'Вердикт',
  jury: 'Мнение присяжных',
}

export const phaseOrder = ['indictment', 'testimony', 'defense', 'objection', 'verdict']
