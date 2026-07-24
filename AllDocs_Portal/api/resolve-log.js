export default async function handler(req, res) {
    // Настройка CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const postgres = await import('@vercel/postgres');
        const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
        const pool = postgres.createPool({ connectionString });

        // Принимаем ID лога из запроса
        const logId = req.query.logId || req.body?.logId;
        const note = req.query.note || req.body?.note;

        if (!logId) {
            return res.status(400).json({ success: false, error: 'No logId provided' });
        }

        // ЖЕСТКО ОБНОВЛЯЕМ ЛОГ В БАЗЕ (убираем Pending)
        await pool.sql`
            UPDATE call_logs 
            SET follow_up_notes = ${note} 
            WHERE id = ${logId};
        `;

        // На всякий случай пытаемся закрыть и уведомление, если оно существует
        try {
            await pool.sql`
                UPDATE notifications 
                SET is_read = true 
                WHERE call_log_id = ${logId};
            `;
        } catch (e) {
            console.log("No notification to update");
        }

        return res.status(200).json({ success: true, message: 'Log resolved directly' });
    } catch (error) {
        console.error('Resolve Log API Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}