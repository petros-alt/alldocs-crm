import { createPool } from '@vercel/postgres';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    const pool = createPool({ connectionString });

    const { 
        clientId, clientName, clientPhone, matterTitle, 
        program, description, operatorName, assignedStaffName, 
        assignedStaffId, followUpNotes, status 
    } = req.body;

    try {
        await pool.sql`
            INSERT INTO call_logs (
                client_id, client_name, client_phone, matter_title, 
                program_category, call_description, operator_name, 
                assigned_staff_name, assigned_staff_id, follow_up_notes, status
            ) VALUES (
                ${clientId}, ${clientName}, ${clientPhone}, ${matterTitle}, 
                ${program}, ${description}, ${operatorName}, 
                ${assignedStaffName}, ${assignedStaffId}, ${followUpNotes}, ${status}
            );
        `;

        if (assignedStaffId && assignedStaffId.trim() !== "") {
            const notificationMessage = `Оператор ${operatorName} передал вам клиента. Проблема: ${description}`;
            await pool.sql`
                INSERT INTO crm_notifications (staff_id, client_name, message)
                VALUES (${assignedStaffId}, ${clientName}, ${notificationMessage});
            `;
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}