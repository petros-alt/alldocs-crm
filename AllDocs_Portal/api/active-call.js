export default async function handler(req, res) {
    // 🚨 ЖЕСТКО ОТКЛЮЧАЕМ КЭШИРОВАНИЕ VERCEL 🚨
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    try {
        const postgres = await import('@vercel/postgres');
        const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
        const pool = postgres.createPool({ connectionString });

        // Автоматически создаем временную таблицу, если её еще нет
        await pool.sql`
            CREATE TABLE IF NOT EXISTS active_incoming_calls (
                id SERIAL PRIMARY KEY,
                phone_number VARCHAR(50) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;

        if (req.method === 'POST') {
            const { phone } = req.body;
            // Удаляем старые номера, чтобы база была чистой
            await pool.sql`DELETE FROM active_incoming_calls`;
            // Записываем номер, который звонит прямо сейчас
            await pool.sql`INSERT INTO active_incoming_calls (phone_number) VALUES (${phone})`;
            return res.status(200).json({ success: true });
            
        } else if (req.method === 'GET') {
            // Норайр запрашивает звонок (ищем только свежие звонки за последние 15 секунд)
            const { rows } = await pool.sql`
                SELECT phone_number 
                FROM active_incoming_calls 
                WHERE created_at > NOW() - INTERVAL '15 seconds' 
                ORDER BY created_at DESC 
                LIMIT 1;
            `;
            if (rows.length > 0) {
                return res.status(200).json({ success: true, phone: rows[0].phone_number });
            } else {
                return res.status(200).json({ success: true, phone: null });
            }
            
        } else {
            return res.status(405).json({ error: 'Method not allowed' });
        }
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
