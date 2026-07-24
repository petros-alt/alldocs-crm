export default async function handler(req, res) {
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

        // Автоматически создаем таблицу для сообщений
        await pool.sql`
            CREATE TABLE IF NOT EXISTS global_messages (
                id INTEGER PRIMARY KEY,
                data JSONB
            );
        `;

        if (req.method === 'GET') {
            const result = await pool.sql`SELECT data FROM global_messages WHERE id = 1;`;
            const messages = result.rows.length > 0 ? result.rows[0].data : [];
            return res.status(200).json({ success: true, messages: messages });
        }

        if (req.method === 'POST') {
            const { messages } = req.body;
            if (!messages) return res.status(400).json({ success: false, error: 'No data' });
            
            await pool.sql`
                INSERT INTO global_messages (id, data) 
                VALUES (1, ${JSON.stringify(messages)})
                ON CONFLICT (id) DO UPDATE 
                SET data = EXCLUDED.data;
            `;
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ success: false, message: 'Method not allowed' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}