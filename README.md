# ODIS

Голосовой список задач для iPhone (PWA): «Сегодня», «Скоро», «Готово». Невыполненное само переносится на сегодня.

- Простые фразы разбираются прямо на телефоне, офлайн: «завтра в 9 утра купить клей на объект Ленина 5», «сделано клей».
- Сложные фразы и голос — через OpenAI-совместимый API (например, ProxyAPI), только если ИИ включён в настройках и дано согласие. Ключ хранится только на устройстве.
- Данные лежат в браузере телефона (localStorage). Сервера нет. Резервная копия — в настройках.

Без сборки: HTML + CSS + JS-модули. Тесты: `npm test` (Node 22+).
Локально: `python3 -m http.server 8080` → http://localhost:8080 (service worker на localhost выключен, включить: `?sw=1`).
Иконки: `python3 tools/make-icons.py`.

## Google Календарь (по желанию)

Задачи можно отправлять в Google Календарь событиями с напоминанием — уведомления на iPhone присылает приложение «Google Календарь». Сервера нет: вход через Google Identity Services прямо в браузере, доступ только `calendar.events.owned`.

Один раз нужно создать свой OAuth Client ID (названия пунктов — как в документации Google; если консоль на русском, пункты те же по смыслу):

1. [console.cloud.google.com](https://console.cloud.google.com) → меню → «IAM & Admin» → «Create a Project» → «Project Name»: ODIS → «Create».
2. Меню → «APIs & Services» → «Library» → «Google Calendar API» → «Enable».
3. Меню → «Google Auth platform» → «Branding» → «Get Started»: «App name» ODIS, «User support email» → «Next»; «Audience»: «External» → «Next»; «Contact Information» → «Next»; отметить «I agree to the Google API Services: User Data Policy» → «Continue» → «Create».
4. «Google Auth platform» → «Audience» → «Test users» → «Add users» → своя почта → «Save». Приложение остаётся в режиме тестирования.
5. «Google Auth platform» → «Clients» → «Create Client» → «Application type»: «Web application» → «Authorized JavaScript origins» → «Add URI»: адрес сайта, например `https://gavrishinigor.github.io` → «Create».
6. Client ID (`…apps.googleusercontent.com`) вставить в ODIS: Настройки → Google Календарь → «Сохранить» → «Подключить Календарь».

Client ID в код не вписывается: он хранится в настройках на телефоне. Вход живёт около часа, потом изменения ждут кнопки «Войти».
