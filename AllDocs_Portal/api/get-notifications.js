export default async function handler(req, res) {
    const { staffId, action, notificationId } = req.query;
    
    try {
        const postgres = await import('@vercel/postgres');
        const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
        const pool = postgres.createPool({ connectionString });

        if (action === 'read' && notificationId) {
            await pool.sql`UPDATE crm_notifications SET is_read = true WHERE id = ${notificationId};`;
            return res.status(200).json({ success: true });
        }

        if (!staffId) return res.status(400).json({ error: "Missing staffId" });
        
        const { rows } = await pool.sql`
            SELECT * FROM crm_notifications 
            WHERE staff_id = ${staffId} AND is_read = false 
            ORDER BY created_at DESC;
        `;
        return res.status(200).json({ success: true, notifications: rows });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
