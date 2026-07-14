export default async function handler(req, res) {
    const { staffId, action, notificationId, note } = req.query;
    
    try {
        const postgres = await import('@vercel/postgres');
        const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
        const pool = postgres.createPool({ connectionString });

        // Если пришла команда "прочитано"
        if (action === 'read' && notificationId) {
            // 1. Помечаем уведомление как закрытое (оно исчезнет из колокольчика)
            await pool.sql`UPDATE crm_notifications SET is_read = true WHERE id = ${notificationId};`;

            // 2. Если сотрудник оставил свой комментарий (note) - сохраняем в Журнал
            if (note && note.trim() !== '') {
                // Ищем имя клиента по ID уведомления
                const notifRes = await pool.sql`SELECT client_name FROM crm_notifications WHERE id = ${notificationId};`;
                if (notifRes.rows.length > 0) {
                    const cName = notifRes.rows[0].client_name;
                    // Находим последнюю запись этого клиента в Журнале и дописываем туда комментарий
                    await pool.sql`
                        UPDATE call_logs
                        SET follow_up_notes = ${note}
                        WHERE client_name = ${cName}
                        AND id IN (SELECT id FROM call_logs WHERE client_name = ${cName} ORDER BY created_at DESC LIMIT 1);
                    `;
                }
            }
            return res.status(200).json({ success: true });
        }

        // Если это обычная проверка новых уведомлений (каждые 3 секунды)
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
