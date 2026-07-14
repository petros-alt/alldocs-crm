export default async function handler(req, res) {
    try {
        // Подключаем библиотеку ВНУТРИ функции, чтобы сервер не падал при старте
        const postgres = await import('@vercel/postgres');
        
        const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
        if (!connectionString) {
            return res.status(500).json({ 
                success: false, 
                error: "В Vercel отсутствуют переменные базы данных (POSTGRES_URL)." 
            });
        }

        const pool = postgres.createPool({ connectionString });
        
        await pool.sql`
            CREATE TABLE IF NOT EXISTS call_logs (
                id SERIAL PRIMARY KEY,
                client_id VARCHAR(50),
                client_name VARCHAR(255),
                client_phone VARCHAR(50),
                matter_title VARCHAR(255),
                program_category VARCHAR(100),
                call_description TEXT,
                operator_name VARCHAR(255),
                assigned_staff_name VARCHAR(255),
                assigned_staff_id VARCHAR(50),
                follow_up_notes TEXT,
                status VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;

        await pool.sql`
            CREATE TABLE IF NOT EXISTS crm_notifications (
                id SERIAL PRIMARY KEY,
                staff_id VARCHAR(50) NOT NULL,
                client_name VARCHAR(255),
                message TEXT,
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;

        return res.status(200).json({ success: true, message: "✅ База успешно настроена! Таблицы созданы." });
    } catch (error) {
        // Эта часть перехватит любую поломку и выведет её прямо на белый экран!
        return res.status(500).json({ 
            success: false, 
            CRASH_REASON: error.message,
            INSTRUCTIONS: "Пожалуйста, скопируйте этот текст и отправьте его мне."
        });
    }
}
