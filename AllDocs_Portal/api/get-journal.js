import { createPool } from '@vercel/postgres';

export default async function handler(req, res) {
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    const pool = createPool({ connectionString });

    try {
        const { rows } = await pool.sql`SELECT * FROM call_logs ORDER BY created_at DESC LIMIT 100;`;
        return res.status(200).json({ success: true, logs: rows });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}