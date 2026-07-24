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

        const body = req.body || {};
        const query = req.query || {};
        
        let phone = body.phone || body.From || query.phone || query.From;
        let text = body.text || body.message || body.Body || query.text || query.message;

        if (!phone || !text) {
            return res.status(400).json({ error: 'Missing phone number or message text' });
        }

        let cleanPhone = phone.replace(/[^\d+]/g, '');
        if (cleanPhone.length === 10 && !cleanPhone.startsWith('+')) {
            cleanPhone = '+1' + cleanPhone;
        } else if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
            cleanPhone = '+' + cleanPhone;
        }

        const result = await pool.sql`SELECT data FROM global_messages WHERE id = 1;`;
        let messages = result.rows.length > 0 ? result.rows[0].data : [];

        // === УМНЫЙ ПОИСК КЛИЕНТА ПО ПОСЛЕДНИМ 10 ЦИФРАМ ===
        let clientName = "Unknown Client";
        let finalPhoneToSave = cleanPhone; 
        
        // Берем ровно 10 последних цифр входящего номера (например 7472042404)
        const incPhone10 = cleanPhone.replace(/[^\d]/g, '').slice(-10);

        // Ищем в истории чатов совпадение по этим 10 цифрам
        const existingMsg = messages.find(m => {
            if (!m.phone) return false;
            const histPhone10 = String(m.phone).replace(/[^\d]/g, '').slice(-10);
            return histPhone10 === incPhone10;
        });

        if (existingMsg) {
            if (existingMsg.name) clientName = existingMsg.name;
            if (existingMsg.phone) finalPhoneToSave = existingMsg.phone; // КРИТИЧНО ВАЖНО: берем оригинальный формат номера с формочки!
        }

        // Создаем объект ВХОДЯЩЕГО сообщения
        const newIncomingMessage = {
            phone: finalPhoneToSave,
            name: clientName,
            text: text,
            timestamp: Date.now(),
            direction: 'in' 
        };

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
