export default async function handler(req, res) {
    const { staffId, action, notificationId, note } = req.query;
    
    try {
        const postgres = await import('@vercel/postgres');
        const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
        const pool = postgres.createPool({ connectionString });

        // Если пришла команда "прочитано" (Mark as Resolved)
        if (action === 'read' && notificationId) {
            
            // 1. Ищем оригинальное уведомление, чтобы узнать имя клиента и ID отправителя
            const notifRes = await pool.sql`SELECT client_name, sender_id FROM crm_notifications WHERE id = ${notificationId};`;
            
            // 2. Закрываем текущее уведомление
            await pool.sql`UPDATE crm_notifications SET is_read = true WHERE id = ${notificationId};`;

            if (notifRes.rows.length > 0) {
                const cName = notifRes.rows[0].client_name;
                const senderId = notifRes.rows[0].sender_id;

                // 3. Сохраняем ответ в Журнал
                if (note && note.trim() !== '') {
                    await pool.sql`
                        UPDATE call_logs
                        SET follow_up_notes = ${note}
                        WHERE client_name = ${cName}
                        AND id IN (SELECT id FROM call_logs WHERE client_name = ${cName} ORDER BY created_at DESC LIMIT 1);
                    `;
                }

                // 4. ПИНГ-ПОНГ: Отправляем ответное уведомление изначальному Оператору!
                if (senderId && senderId.trim() !== '') {
                    const replyNote = note ? note : "No additional notes.";
                    const pingMessage = `✅ Issue Resolved for client ${cName}.\nResolution: ${replyNote}`;
                    
                    await pool.sql`
                        INSERT INTO crm_notifications (staff_id, client_name, message, sender_id)
                        VALUES (${senderId}, ${cName}, ${pingMessage}, '');
                    `;
                }
            }
            return res.status(200).json({ success: true });
        }

        // Обычная проверка колокольчика
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
