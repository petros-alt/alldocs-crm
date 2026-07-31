import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    SCOPES
);
const calendar = google.calendar({ version: 'v3', auth });
const calendarId = 'alldocsconsulting@gmail.com';

function extractFromDescription(desc, fieldName) {
    if (!desc) return '';
    const regex = new RegExp(`${fieldName}:\\s*(.+)`, 'i');
    const match = desc.match(regex);
    return match ? match[1].trim() : '';
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        if (req.method === 'GET') {
            const now = new Date();
            const minDate = new Date(); minDate.setMonth(now.getMonth() - 1);
            const maxDate = new Date(); maxDate.setMonth(now.getMonth() + 6);

            const response = await calendar.events.list({
                calendarId: calendarId,
                timeMin: minDate.toISOString(),
                timeMax: maxDate.toISOString(),
                singleEvents: true,
                orderBy: 'startTime',
            });

            const googleEvents = response.data.items || [];
            
            const mappedAppointments = googleEvents.map(event => {
                const startDateTime = event.start.dateTime || event.start.date;
                if (!startDateTime) return null;

                const startDateObj = new Date(startDateTime);
                
                let hours = startDateObj.getHours();
                let minutes = startDateObj.getMinutes();
                const ampm = hours >= 12 ? 'PM' : 'AM';
                hours = hours % 12;
                hours = hours ? hours : 12; 
                const formattedTime = hours.toString().padStart(2, '0') + ':' + minutes.toString().padStart(2, '0') + ' ' + ampm;

                const desc = event.description || '';
                const phone = extractFromDescription(desc, 'Phone') || '';
                const staff = extractFromDescription(desc, 'Staff') || 'Admin';
                const service = extractFromDescription(desc, 'Service') || 'General Appointment';
                const message = extractFromDescription(desc, 'Note') || '';
                const length = extractFromDescription(desc, 'Duration') || '30 minutes';

                return {
                    id: event.id, 
                    client: event.summary || 'Unknown Client',
                    dateStr: startDateObj.toDateString(), 
                    timestamp: startDateObj.getTime(),
                    time: formattedTime,
                    location: event.location || '',
                    phone: phone,
                    staff: staff,
                    service: service,
                    length: length,
                    message: message,
                    reminder: 'Text', 
                    language: 'ENG'
                };
            }).filter(item => item !== null); 

            return res.status(200).json({ success: true, appointments: mappedAppointments });
        }

        if (req.method === 'POST') {
            const { appointments } = req.body;
            
            if (!appointments) {
                return res.status(400).json({ success: false, error: 'No appointments data provided' });
            }

            // Подключаем базу прямо внутри запроса, как было у тебя раньше
            const postgres = await import('@vercel/postgres');
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

            return res.status(200).json({ success: true, message: 'Saved successfully.' });
        }

        return res.status(405).json({ success: false, message: 'Method not allowed' });

    } catch (error) {
        console.error('Appointments API Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
