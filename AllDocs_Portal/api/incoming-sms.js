export default async function handler(req, res) {
    // Разрешаем запросы извне
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const postgres = await import('@vercel/postgres');
        const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
        const pool = postgres.createPool({ connectionString });

        // Разные сервисы (Zapier, Twilio, RingCentral) присылают данные в разных форматах.
        // Мы ловим все возможные варианты названия полей:
        const body = req.body || {};
        const query = req.query || {};
        
        let phone = body.phone || body.From || query.phone || query.From;
        let text = body.text || body.message || body.Body || query.text || query.message;

        if (!phone || !text) {
            return res.status(400).json({ error: 'Missing phone number or message text' });
        }

        // Очищаем номер от лишних символов (оставляем только цифры)
        let cleanPhone = phone.replace(/[^\d+]/g, '');
        if (cleanPhone.length === 10 && !cleanPhone.startsWith('+')) {
            cleanPhone = '+1' + cleanPhone;
        } else if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
            cleanPhone = '+' + cleanPhone;
        }

        // 1. Получаем текущую историю ВСЕХ сообщений из базы
        const result = await pool.sql`SELECT data FROM global_messages WHERE id = 1;`;
        let messages = result.rows.length > 0 ? result.rows[0].data : [];

        // 2. Ищем имя клиента по номеру (проверяем, общались ли мы с ним ранее)
        let clientName = "Unknown Client";
        const existingMsg = messages.find(m => m.phone && m.phone.includes(cleanPhone.replace('+', '')));
        if (existingMsg && existingMsg.name) {
            clientName = existingMsg.name;
        }

        // 3. Создаем объект ВХОДЯЩЕГО сообщения
        const newIncomingMessage = {
            phone: cleanPhone,
            name: clientName,
            text: text,
            timestamp: Date.now(),
            direction: 'in' // 'in' означает входящее (будет слева в чате)
        };

        // 4. Добавляем в массив и сохраняем обратно в базу
        messages.push(newIncomingMessage);

        await pool.sql`
            INSERT INTO global_messages (id, data) 
            VALUES (1, ${JSON.stringify(messages)})
            ON CONFLICT (id) DO UPDATE 
            SET data = EXCLUDED.data;
        `;

        return res.status(200).json({ success: true, message: 'Incoming SMS processed successfully' });
    } catch (error) {
        console.error('Incoming SMS Webhook Error:', error);
        return res.status(500).json({ error: error.message });
    }
}