export default async function handler(req, res) {
    // ВАЖНО: Добавлен параметр logId
    const { staffId, action, notificationId, logId, note } = req.query;
    
    try {
        const postgres = await import('@vercel/postgres');
        const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
        const pool = postgres.createPool({ connectionString });

        // Если пришла команда на закрытие (Mark as Resolved)
        if (action === 'read') {
            const finalNote = (note && note.trim() !== '') ? note.trim() : 'Task closed without comments';
            let cName = null;
            let senderId = null;

            // 1. Если колокольчик ЕСТЬ, закрываем его
            if (notificationId && notificationId !== 'undefined' && notificationId !== '') {
                const notifRes = await pool.sql`SELECT client_name, sender_id FROM crm_notifications WHERE id = ${notificationId};`;
                if (notifRes.rows.length > 0) {
                    cName = notifRes.rows[0].client_name;
                    senderId = notifRes.rows[0].sender_id;
                }
                await pool.sql`UPDATE crm_notifications SET is_read = true WHERE id = ${notificationId};`;
            }

            // 2. ЖЕСТКОЕ ЗАКРЫТИЕ ЖУРНАЛА - работает ВСЕГДА, даже если колокольчика уже нет
            if (logId && logId !== 'undefined' && logId !== '') {
                await pool.sql`
                    UPDATE call_logs
                    SET follow_up_notes = ${finalNote}, status = 'Resolved'
                    WHERE id = ${logId};
                `;
            }

            // 3. Отправляем уведомление-ответ изначальному оператору (Пинг-понг)
            if (senderId && senderId.trim() !== '' && cName) {
                const pingMessage = `✅ Issue Resolved for client ${cName}.\nResolution: ${finalNote}`;
                await pool.sql`
                    INSERT INTO crm_notifications (staff_id, client_name, message, sender_id)
                    VALUES (${senderId}, ${cName}, ${pingMessage}, '');
                `;
            }
            
            return res.status(200).json({ success: true });
        }

        // Обычная логика загрузки меню уведомлений
        if (!staffId) return res.status(400).json({ error: "Missing staffId" });
        
        const { rows } = await pool.sql`
            SELECT * FROM crm_notifications 
            WHERE staff_id = ${staffId} AND is_read = false 
            ORDER BY created_at DESC;
        `;
        return res.status(200).json({ success: true, notifications: rows });
    } catch (error) {
        console.error("Notif Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
