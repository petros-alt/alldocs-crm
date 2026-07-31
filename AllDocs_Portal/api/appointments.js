import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar'];
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
        // --- ЧТЕНИЕ ИЗ ГУГЛ КАЛЕНДАРЯ ---
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
                return {
                    id: event.id, 
                    client: event.summary || 'Unknown Client',
                    dateStr: startDateObj.toDateString(), 
                    timestamp: startDateObj.getTime(),
                    time: formattedTime,
                    location: event.location || '',
                    phone: extractFromDescription(desc, 'Phone') || '',
                    staff: extractFromDescription(desc, 'Staff') || 'Admin',
                    service: extractFromDescription(desc, 'Service') || 'General Appointment',
                    length: extractFromDescription(desc, 'Duration') || '1 hour',
                    message: extractFromDescription(desc, 'Note') || '',
                    isLead: (event.colorId === '11')
                };
            }).filter(item => item !== null); 

            return res.status(200).json({ success: true, appointments: mappedAppointments });
        }

        // --- УДАЛЕНИЕ ИЗ ГУГЛ КАЛЕНДАРЯ ---
        if (req.method === 'DELETE') {
            const { id } = req.body;
            if (!id) return res.status(400).json({ success: false, error: 'No ID provided' });
            
            await calendar.events.delete({ calendarId: calendarId, eventId: id });
            return res.status(200).json({ success: true, message: 'Deleted successfully' });
        }

        // --- СОЗДАНИЕ И РЕДАКТИРОВАНИЕ В ГУГЛ КАЛЕНДАРЕ ---
        if (req.method === 'POST' || req.method === 'PUT') {
            const { newAppointment } = req.body;
            if (!newAppointment) return res.status(400).json({ success: false, error: 'No appointment data' });

            const apptDate = new Date(newAppointment.timestamp);
            const startTime = apptDate.toISOString();
            
            let durationMins = 60; 
            if (newAppointment.length) {
                let mins = 0;
                const hrMatch = newAppointment.length.match(/(\d+)\s*hour/);
                if (hrMatch) mins += parseInt(hrMatch[1], 10) * 60;
                const minMatch = newAppointment.length.match(/(\d+)\s*minute/);
                if (minMatch) mins += parseInt(minMatch[1], 10);
                if (mins > 0) durationMins = mins;
            }
            
            const endDate = new Date(apptDate.getTime() + durationMins * 60000);
            const endTime = endDate.toISOString();

            const descText = `Phone: ${newAppointment.phone}\nService: ${newAppointment.service}\nStaff: ${newAppointment.staff}\nDuration: ${newAppointment.length}\nNote: ${newAppointment.message || ''}\n\nBooked via CRM.`;

            const event = {
                summary: `${newAppointment.client}`,
                location: newAppointment.location,
                description: descText,
                start: { dateTime: startTime, timeZone: 'America/Los_Angeles' },
                end: { dateTime: endTime, timeZone: 'America/Los_Angeles' },
                colorId: newAppointment.isLead ? '11' : '9', 
            };

            if (req.method === 'PUT' && newAppointment.id) {
                // Если передали ID - обновляем существующее (EDIT)
                await calendar.events.update({
                    calendarId: calendarId,
                    eventId: newAppointment.id,
                    requestBody: event,
                });
            } else {
                // Если ID нет - создаем новое (CREATE)
                await calendar.events.insert({
                    calendarId: calendarId,
                    requestBody: event,
                });
            }

            return res.status(200).json({ success: true, message: 'Saved successfully.' });
        }

        return res.status(405).json({ success: false, message: 'Method not allowed' });

    } catch (error) {
        console.error('Appointments API Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
