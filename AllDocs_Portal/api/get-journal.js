export default async function handler(req, res) {
    try {
        const postgres = await import('@vercel/postgres');
        const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
        const pool = postgres.createPool({ connectionString });

        const search = req.query.search || '';
        let rows;

        if (search) {
            // === УМНЫЙ ПОИСК ПО ВСЕЙ ИСТОРИИ ===
            
            const likeSearch = `%${search}%`; // Для поиска по тексту (имена, заметки)
            const cleanPhone = search.replace(/\D/g, ''); // Очищаем запрос от скобок и тире (оставляем только цифры)
            const phoneSearch = cleanPhone ? `%${cleanPhone}%` : 'IMPOSSIBLE_MATCH'; // Защита от пустых поисков

            // Ищем совпадения в любом из полей без ограничения по датам!
            const result = await pool.sql`
                SELECT * FROM call_logs 
                WHERE 
                    client_name ILIKE ${likeSearch}
                    OR call_description ILIKE ${likeSearch}
                    OR operator_name ILIKE ${likeSearch}
                    OR assigned_staff_name ILIKE ${likeSearch}
                    OR REGEXP_REPLACE(client_phone, '\\D', '', 'g') ILIKE ${phoneSearch}
                ORDER BY created_at DESC
                LIMIT 200; -- Выдаем до 200 совпадений, чтобы браузер не завис
            `;
            rows = result.rows;
            
        } else {
            // === СТАНДАРТНАЯ ЗАГРУЗКА (ЕСЛИ ПОИСК ПУСТ) ===
            
            // Выгружаем только логи за последние 30 дней
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
