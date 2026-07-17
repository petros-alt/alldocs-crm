export default async function handler(req, res) {
    // ЖЕСТКО Отключаем кэширование, чтобы база всегда была свежей
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    try {
        const postgres = await import('@vercel/postgres');
        const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
        const pool = postgres.createPool({ connectionString });

        // Создаем таблицу для общих контактов, если её нет
        await pool.sql`
            CREATE TABLE IF NOT EXISTS crm_shared_data (
                key_name VARCHAR(50) PRIMARY KEY,
                data_value JSONB
            );
        `;

        if (req.method === 'POST') {
            // Сохраняем контакты в облако
            const { linked_numbers } = req.body;
            await pool.sql`
                INSERT INTO crm_shared_data (key_name, data_value) 
                VALUES ('linked_numbers', ${JSON.stringify(linked_numbers)})
                ON CONFLICT (key_name) DO UPDATE SET data_value = EXCLUDED.data_value;
            `;
            return res.status(200).json({ success: true });
            
        } else if (req.method === 'GET') {
            // Отдаем контакты всем, кто их просит
            const { rows } = await pool.sql`SELECT data_value FROM crm_shared_data WHERE key_name = 'linked_numbers'`;
            if (rows.length > 0) {
                return res.status(200).json({ success: true, data: rows[0].data_value });
            } else {
                return res.status(200).json({ success: true, data: {} });
            }
        } else {
            return res.status(405).json({ error: 'Method not allowed' });
        }
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
