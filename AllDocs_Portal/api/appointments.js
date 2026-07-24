export default async function handler(req, res) {
    // Настройка CORS для работы из браузера
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        // Подключаемся к базе данных точно так же, как в get-journal.js
        const postgres = await import('@vercel/postgres');
        const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
        const pool = postgres.createPool({ connectionString });

        // Автоматически создаем таблицу для хранения календаря, если её еще нет
        await pool.sql`
            CREATE TABLE IF NOT EXISTS global_appointments (
                id INTEGER PRIMARY KEY,
                data JSONB
            );
        `;

        // ==========================================
        // 1. ОТДАЕМ КАЛЕНДАРЬ ФРОНТЕНДУ (GET)
        // ==========================================
        if (req.method === 'GET') {
            const result = await pool.sql`SELECT data FROM global_appointments WHERE id = 1;`;
            
            // Если данные есть, отдаем их. Если база еще пустая — отдаем пустой массив.
            const appointments = result.rows.length > 0 ? result.rows[0].data : [];
            return res.status(200).json({ success: true, appointments: appointments });
        }

        // ==========================================
        // 2. СОХРАНЯЕМ НОВЫЕ ЗАПИСИ (POST)
        // ==========================================
        if (req.method === 'POST') {
            const { appointments } = req.body;
            
            if (!appointments) {
                return res.status(400).json({ success: false, error: 'No appointments data provided' });
            }

            // Перезаписываем единый массив календаря (upsert). 
            // Если id = 1 уже есть, он обновляет данные. Если нет — вставляет.
            await pool.sql`
                INSERT INTO global_appointments (id, data) 
                VALUES (1, ${JSON.stringify(appointments)})
                ON CONFLICT (id) DO UPDATE 
                SET data = EXCLUDED.data;
            `;

            return res.status(200).json({ success: true, message: 'Appointments successfully saved to PostgreSQL' });
        }

        return res.status(405).json({ success: false, message: 'Method not allowed' });

    } catch (error) {
        console.error('Appointments API Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}