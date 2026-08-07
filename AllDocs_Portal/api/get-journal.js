export default async function handler(req, res) {
    try {
        const postgres = await import('@vercel/postgres');
        const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
        const pool = postgres.createPool({ connectionString });

        const search = req.query.search || '';
        const staff = req.query.staff || 'All'; 
        
        // Ловим параметры пагинации (по умолчанию берем 30 карточек и начинаем с самого начала)
        const limit = parseInt(req.query.limit) || 30;
        const offset = parseInt(req.query.offset) || 0;
        
        let rows;

        if (search || staff !== 'All') {
            const likeSearch = search ? `%${search}%` : '%';
            const cleanPhone = search ? search.replace(/\D/g, '') : '';
            const phoneSearch = cleanPhone ? `%${cleanPhone}%` : 'IMPOSSIBLE_MATCH';
            const staffMatch = staff !== 'All' ? staff : '%';

            // При поиске тоже применяем лимиты, чтобы не перегружать сеть
            const result = await pool.sql`
                SELECT * FROM call_logs 
                WHERE 
                    (
                        client_name ILIKE ${likeSearch}
                        OR call_description ILIKE ${likeSearch}
                        OR REGEXP_REPLACE(client_phone, '\\D', '', 'g') ILIKE ${phoneSearch}
                        OR ${search} = ''
                    )
                    AND (
                        assigned_staff_name ILIKE ${staffMatch} 
                        OR operator_name ILIKE ${staffMatch}
                        OR ${staff} = 'All'
                    )
                ORDER BY created_at DESC
                LIMIT ${limit} OFFSET ${offset};
            `;
            rows = result.rows;
        } else {
            // ГЛАВНАЯ ОПТИМИЗАЦИЯ: Убрали привязку ко времени.
            // Теперь грузим строго по лимиту (30 штук) и делаем отступ, если оператор листает вниз.
            const result = await pool.sql`
                SELECT * FROM call_logs 
                ORDER BY created_at DESC
                LIMIT ${limit} OFFSET ${offset};
            `;
            rows = result.rows;
        }
        
        return res.status(200).json({ success: true, logs: rows });
    } catch (error) {
        console.error("Journal Fetch Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
