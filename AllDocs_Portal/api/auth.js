export default async function handler(req, res) {
    // Берем ID и Пароль из Vercel
    const clientId = process.env.DOCKETWISE_CLIENT_ID;
    const clientSecret = process.env.DOCKETWISE_CLIENT_SECRET;
    const redirectUri = 'https://alldocsportal.vercel.app/api/auth';

    if (!clientId || !clientSecret) {
        return res.status(500).send("Ошибка: Ключи не найдены в Vercel.");
    }

    const { code } = req.query;

    // ШАГ А: Если мы только зашли, перенаправляем вас на сайт Docketwise для нажатия "Разрешить"
    if (!code) {
        const authUrl = `https://app.docketwise.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}`;
        return res.redirect(authUrl);
    }

    // ШАГ Б: Вы нажали "Разрешить". Docketwise вернул код. Мы обмениваем его на Access Token!
    try {
        const tokenResponse = await fetch('https://app.docketwise.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: redirectUri
            })
        });

        const tokenData = await tokenResponse.json();

        if (tokenData.access_token) {
            // Выводим токен прямо на экран большими буквами
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.status(200).send(`
                <div style="font-family: sans-serif; padding: 40px; text-align: center; background: #f4f4f9;">
                    <h1 style="color: #2e7d32;">УРА! Доступ успешно получен! 🎉</h1>
                    <p style="font-size: 18px;">Вот ваш пропуск (Access Token) на следующие 180 дней. Скопируйте его целиком:</p>
                    <textarea style="width: 100%; max-width: 700px; height: 150px; padding: 15px; font-size: 16px; border: 2px solid #2e7d32; border-radius: 8px;">${tokenData.access_token}</textarea>
                    <div style="margin-top: 30px; text-align: left; max-width: 700px; margin-left: auto; margin-right: auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                        <h3>Что делать дальше:</h3>
                        <ol style="line-height: 1.6;">
                            <li>Скопируйте весь текст из окна выше.</li>
                            <li>Зайдите в настройки проекта <b>Vercel -> Environment Variables</b>.</li>
                            <li>Отредактируйте переменную <b>DOCKETWISE_CLIENT_SECRET</b>: удалите оттуда старый короткий пароль и вставьте этот длинный токен.</li>
                            <li>Нажмите <b>Save</b> и сделайте <b>Redeploy</b> во вкладке Deployments.</li>
                            <li>Всё! Система полностью готова к работе!</li>
                        </ol>
                    </div>
                </div>
            `);
        } else {
            return res.status(400).json({ error: "Не удалось получить токен. Возможно, вы уже использовали этот код.", details: tokenData });
        }
    } catch (error) {
        return res.status(500).json({ error: "Ошибка сервера при обмене токена." });
    }
}