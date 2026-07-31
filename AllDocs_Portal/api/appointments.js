import { google } from 'googleapis';
// Подключаем базу данных, как у тебя и было
import postgres from '@vercel/postgres'; 

// Настраиваем доступ к Гуглу через переменные окружения Vercel
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    // Vercel иногда ломает переносы строк, эта команда .replace всё исправляет
    (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    SCOPES
);
const calendar = google.calendar({ version: 'v3', auth });
const calendarId = 'alldocsconsulting@gmail.com'; // Твой фиолетовый календарь

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
        // ==========================================
        // 1. ОТДАЕМ КАЛЕНДАРЬ ФРОНТЕНДУ (GET) - ТЕПЕРЬ ИЗ GOOGLE!
        // ==========================================
        if (req.method === 'GET') {
            // Запрашиваем события от текущего момента и на 3 месяца вперед
            const now = new Date();
            const future = new Date();
            future.setMonth(now.getMonth() + 3);

            const response = await calendar.events.list({
                calendarId: calendarId,
                timeMin: now.toISOString(),
                timeMax: future.toISOString(),
                singleEvents: true,
                orderBy: 'startTime',
            });

            // Массив всех встреч из Гугла
            const events = response.data.items; 
            
            // Отправляем их в твою форму
            return res.status(200).json({ success: true, appointments: events });
        }

        // ==========================================
        // 2. СОХРАНЯЕМ НОВЫЕ ЗАПИСИ (POST) - Пока оставляем старую логику
        // ==========================================
        if (req.method === 'POST') {
            const { appointments } = req.body;
            
            if (!appointments) {
                return res.status(400).json({ success: false, error: 'No appointments data provided' });
            }

            const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
            const pool = postgres.createPool({ connectionString });

            await pool.sql`
                CREATE TABLE IF NOT EXISTS global_appointments (
                    id INTEGER PRIMARY KEY,
                    data JSONB
                );
            `;

            await pool.sql`
                INSERT INTO global_appointments (id, data) 
                VALUES (1, ${JSON.stringify(appointments)})
                ON CONFLICT (id) DO UPDATE 
                SET data = EXCLUDED.data;
            `;

            return res.status(200).json({ success: true, message: 'Appointments saved to DB (Google sync pending)' });
        }

        return res.status(405).json({ success: false, message: 'Method not allowed' });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
