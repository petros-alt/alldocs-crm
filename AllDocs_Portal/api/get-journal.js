export default async function handler(req, res) {
    try {
        const postgres = await import('@vercel/postgres');
        const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
        const pool = postgres.createPool({ connectionString });

        const search = req.query.search || '';
        const staff = req.query.staff || 'All'; // Ловим фильтр сотрудника
        let rows;

        // Если есть поиск ИЛИ выбран конкретный сотрудник — ищем по всей базе без лимита дней!
        if (search || staff !== 'All') {
            const likeSearch = search ? `%${search}%` : '%';
            const cleanPhone = search ? search.replace(/\D/g, '') : '';
            const phoneSearch = cleanPhone ? `%${cleanPhone}%` : 'IMPOSSIBLE_MATCH';
            const staffMatch = staff !== 'All' ? staff : '%';

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
                LIMIT 200;
            `;
            rows = result.rows;
        } else {
            // Если всё пусто — грузим только последние 30 дней для скорости
            const result = await pool.sql`
                SELECT * FROM call_logs 
                WHERE created_at > NOW() - INTERVAL '30 days'
                ORDER BY created_at DESC;
            `;
            rows = result.rows;
        }
        
        return res.status(200).json({ success: true, logs: rows });
    } catch (error) {
        console.error("Journal Fetch Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
