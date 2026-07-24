export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const postgres = await import('@vercel/postgres');
        const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
        const pool = postgres.createPool({ connectionString });

        const logId = req.query.logId;
        const note = req.query.note;

        if (!logId) {
            return res.status(400).json({ success: false, error: 'No logId provided' });
        }

        // ЖЕСТКО ОБНОВЛЯЕМ ЛОГ (Убиваем Pending)
        await pool.sql`
            UPDATE call_logs 
            SET follow_up_notes = ${note}, status = 'Resolved'
            WHERE id = ${logId};
        `;

        // Пытаемся закрыть и уведомление, если оно существует
        try {
            await pool.sql`
                UPDATE notifications 
                SET is_read = true 
                WHERE call_log_id = ${logId};
            `;
        } catch (e) { }

        return res.status(200).json({ success: true, message: 'Log resolved directly' });
    } catch (error) {
        console.error('Resolve Log Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
