# GuideEye — как снять демо-видео (2 минуты)

Реплики, которые нужно произносить, даны на английском **жирным**. Всё остальное — что делать.

Итог: 7 коротких клипов → склейка → загрузка на Devpost. На всё около 50 минут.

---

## 0. Что должно быть под рукой

- Ноутбук с запущенным сервисом GuideEye.
- Второй телефон — показать QR-код оплаты.
- Связка ключей (или другой заметный предмет) на столе.
- Второй человек — для сцен 2 и 6.
- WhatsApp Desktop открыт, вход выполнен.

---

## 1. Подготовка (10 минут, без записи)

### 1.1 Сервис

Если сервис не запущен, в папке проекта выполните:

```bash
python -m uvicorn backend.app.main:app --port 8000
```

### 1.2 Chrome — вкладка 1: демо

1. Откройте `http://localhost:8000/#demo`.
2. Нажмите **Ctrl+Shift+R** (жёсткое обновление).
3. В строке статуса должно быть: `Connected · on-device detector · Gemini connected · ElevenLabs voice · Stripe test mode`.
4. Разрешите микрофон, камеру и геолокацию, когда Chrome спросит.
5. В адресной строке справа разрешите **всплывающие окна** для `localhost:8000`.

Выставьте переключатели под видео:

| Переключатель | Положение |
| --- | --- |
| Microphone always on | включён |
| Only act when I say "Guide" first | **выключен** (включите, только если в зале очень шумно) |
| Speak hazard warnings | включён |
| Speak replies | включён |
| Tell me when the scene changes | выключен |
| Use my location | **включён** |
| Remember what I see, every 20 seconds | выключен |

6. Нажмите **Turn camera on** и дождитесь зелёных рамок на видео (первый кадр — около 4 секунд).
7. Над чатом должно быть `Microphone on — listening` с красной точкой.

### 1.3 Chrome — вкладка 2: Stripe

Откройте Stripe Dashboard → включите **Test mode** → **Payments**. Оставьте вкладку открытой.

### 1.4 Телефон: QR-код оплаты

На втором телефоне или втором экране откройте QR-код. Самый простой способ: в демо под чатом нажмите ссылку **this demo payment code**, сфотографируйте QR телефоном и откройте фото на весь экран с максимальной яркостью.

### 1.5 Контакт для WhatsApp

Вкладка **Family** → убедитесь, что есть контакт с настоящим номером (сейчас это Tim и Tom). В сцене 5 называйте именно это имя.

### 1.6 Память

Вкладка **Memory** → **Erase memory** → подтвердить.

### 1.7 Пробный прогон

Без записи скажите: **"What's in front of me?"** Ассистент должен ответить голосом. Если ответил — можно снимать.

---

## 2. Как записывать

**Экран:** нажмите **Win+Shift+R** (Snipping Tool).

1. В панели сверху включите **оба** значка звука: микрофон и системный звук. Без этого не будет слышно ни вас, ни ассистента.
2. Выделите мышью весь экран.
3. Нажмите **Start**. После сцены — **Stop** и **Save**.

**Сцены 2 и 6** можно снять телефоном через плечо, чтобы были видны и человек, и экран.

Правила для всех сцен:

- Одна сцена — один клип. Не получилось — переснимите только её.
- Говорите чётко. После фразы молчите секунду: ассистент отправляет фразу, когда вы замолчали.
- Над чатом появляется `Heard: "…"` — так видно, что он вас услышал.
- Не говорите, пока ассистент отвечает, если не хотите его перебить.

---

## 3. Сцены

### Сцена 1 — Вступление (0:00–0:12)

**На экране:** лендинг сверху, заголовок "The AI that sees, remembers and acts for you".

**Действие:** медленно прокрутите страницу вниз до раздела "See. Remember. Act.".

**Говорите:**

> **"Vision apps for blind people make you aim a phone and tap buttons — and they forget everything when you close them. GuideEye is different. It sees, remembers, and acts. Hands-free."**

---

### Сцена 2 — See (0:12–0:32)

**На экране:** раздел Live demo, вкладка Assistant, камера включена.

**Действие:**

1. Начните запись, когда в кадре камеры никого нет.
2. Второй человек входит в кадр. Ассистент говорит "Person ahead." и рисует рамку.
3. Говорите:

> **"Hazard warnings run locally on the laptop, in under a tenth of a second. No cloud."**

4. Затем вопрос ассистенту:

> **"What's in front of me?"**

5. Дождитесь ответа целиком.

---

### Сцена 3 — Remember (0:32–0:52)

**На экране:** вкладка Assistant.

**Действие:**

1. Наведите камеру на стол с ключами.
2. Скажите:

> **"Remember this."**

3. Дождитесь ответа ("I will remember this…").
4. Отведите камеру в сторону, чтобы ключей не было видно.
5. Скажите:

> **"Where did I leave my keys?"**

6. После ответа:

> **"It keeps a private, text-only memory. No photos, no audio."**

Если ассистент в описании не упомянул ключи, переснимите: поднесите их ближе к камере на светлом фоне.

---

### Сцена 4 — Act (0:52–1:15)

**На экране:** вкладка Assistant, затем вкладка Stripe.

**Действие:**

1. Поднесите телефон с QR-кодом к камере ноутбука. QR должен занимать большую часть кадра, без бликов.
2. Скажите:

> **"Pay this."**

3. Ассистент: "I scanned a payment code. Coffee for $4.50. Say yes to pay, or no to cancel."
4. Скажите:

> **"Yes."**

5. Ассистент: "Done. I paid $4.50 for Coffee. Paid in Stripe test mode." Под ответом появится строка `Stripe test payment · succeeded · pi_…`.
6. Переключитесь на вкладку Stripe, нажмите F5 — сверху новый платёж на $4.50.
7. Скажите:

> **"A real Stripe payment — and money never moves without a spoken yes."**

Запасной вариант, если QR не читается: скажите **"Buy me a coffee."** → **"Yes."**

---

### Сцена 5 — Where am I и Family (1:15–1:35)

**На экране:** вкладка Assistant, затем WhatsApp.

**Действие:**

1. Скажите:

> **"Where am I?"**

2. Ассистент называет адрес ("You are at Y Combinator, 580 20th Street…").
3. Скажите (имя — как в контактах):

> **"Tell Tim where I am."**

4. Ассистент зачитывает сообщение и спрашивает подтверждение.
5. Скажите:

> **"Yes."**

6. Откроется WhatsApp Desktop, сообщение отправится само через 4–5 секунд. **Не трогайте мышь и клавиатуру, пока оно не ушло.**
7. Скажите:

> **"It knows where I am, and it can tell my family."**

---

### Сцена 6 — Bridge (1:35–1:52)

**На экране:** вкладка **Bridge**, камера включена. Лучше снимать телефоном через плечо.

**Действие:**

1. Откройте вкладку Bridge. Дождитесь надписи `Reading signs live, on this device.`
2. Скажите:

> **"Bridge connects blind and deaf people. Signs are read on the device and spoken."**

3. Второй человек показывает в камеру **большой палец вверх** 👍 и держит 1–2 секунды. Ассистент говорит "yes", на экране `Yes · …% sure`.
4. Затем **два пальца** ✌️ — "peace".
5. Нажмите **Show them — big view**.
6. Скажите:

> **"Hello, my name is Tim."**

7. На весь экран появляются слова по строкам и жесты по буквам.
8. Скажите:

> **"And my speech becomes text and fingerspelling for them."**

Как показывать жесты: рука целиком в кадре, ладонью к камере, хороший свет, на расстоянии 40–70 см.

---

### Сцена 7 — Финал (1:52–2:00)

**На экране:** строка статуса демо, затем верх лендинга.

**Говорите:**

> **"Built with Gemini, ElevenLabs, Stripe and Deepgram. GuideEye is an accessibility companion."**

---

## 4. Если что-то пошло не так

| Проблема | Что делать |
| --- | --- |
| Ассистент не реагирует на голос | Посмотрите на надпись над чатом. `Microphone off` — включите "Microphone always on". `Heard: … — waiting for "Guide"` — выключите переключатель про "Guide" |
| Слышит, но не то | Говорите ближе к микрофону; в шуме включите переключатель про "Guide" и начинайте фразы с "Guide, …" |
| Вместо голоса ElevenLabs — робот | Закончились кредиты ключа ElevenLabs. Поднимите лимит ключа |
| "I need the camera for that" | Камера выключена — нажмите "Turn camera on" |
| "I need your location" | Включите "Use my location" и разрешите геолокацию |
| QR не сканируется | Поднесите ближе, уберите блики, прибавьте яркость. Запасной вариант: "Buy me a coffee" |
| WhatsApp открылся, но не отправил | Окно WhatsApp не успело открыться. Не трогайте мышь; при повторе нажмите Enter вручную |
| Жест не распознаётся | Держите руку неподвижно 1–2 секунды, ладонью к камере. Самые надёжные: 👍 и ✌️ |
| "Not connected to the GuideEye service" | Сервис упал. Запустите команду из раздела 1.1 и обновите страницу |
| Страница выглядит по-старому | Ctrl+Shift+R |

---

## 5. Склейка и отправка

1. Откройте **Clipchamp** (есть в Windows 11) → новое видео → перетащите 7 клипов по порядку.
2. Обрежьте паузы ожидания. Ответы ассистента оставляйте целиком.
3. Проверьте длительность: **не больше 2:00**.
4. Экспорт → 1080p.
5. Загрузите на YouTube (доступ по ссылке) или сразу на Devpost — как требует форма.
6. **Начните загрузку не позже 17:50.** Видео грузится долго.

---

## 6. Минута вопросов: честные ответы


**Это настоящий платёж?**
"It's a real Stripe API payment in test mode. The code refuses live keys and anything over a fifty-dollar limit, and it never pays without a spoken yes."

**Что хранится?**
"Text notes only — what was seen, what was asked, where the user was. No photos, video or audio. One command erases it."

**Это перевод жестового языка?**
"No. It reads a set of hand signs and ASL fingerspelling on-device, and shows speech as text and fingerspelling. Full sign-language translation is future work."

**Что локально, а что в облаке?**
"Hazard detection and sign reading run on the device. Scene description and memory answers use Gemini, voice uses ElevenLabs."
