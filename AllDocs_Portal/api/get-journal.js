export default async function handler(req, res) {
    try {
        const postgres = await import('@vercel/postgres');
        const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
        const pool = postgres.createPool({ connectionString });

        // Выгружаем только логи за последние 30 дней
        const { rows } = await pool.sql`
            SELECT * FROM call_logs 
            WHERE created_at > NOW() - INTERVAL '30 days'
            ORDER BY created_at DESC;
        `;
        
        return res.status(200).json({ success: true, logs: rows });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
