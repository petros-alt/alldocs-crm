import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar'];
const auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    SCOPES
);
const calendar = google.calendar({ version: 'v3', auth });

// ОСНОВНОЙ И GOREMINDERS КАЛЕНДАРИ
const mainCalendarId = 'alldocsconsulting@gmail.com';
const goRemindersCalendarId = '7e8083f42a108266dd9aafe7cc4cdad45578530f1d198fdbe7018013c1692d26@group.calendar.google.com';

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

            let allEvents = [];
            const calendarsToFetch = [mainCalendarId, goRemindersCalendarId];

            for (const calId of calendarsToFetch) {
                try {
                    const response = await calendar.events.list({
                        calendarId: calId,
                        timeMin: minDate.toISOString(),
                        timeMax: maxDate.toISOString(),
                        singleEvents: true,
                        orderBy: 'startTime',
                    });
                    const items = response.data.items || [];
                    allEvents.push(...items.map(ev => ({ ...ev, _isGoReminders: calId === goRemindersCalendarId })));
                } catch (err) {
                    console.error(`Ошибка чтения календаря ${calId}:`, err);
                }
            }
            
            const mappedAppointments = allEvents.map(event => {
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
                    staff: extractFromDescription(desc, 'Staff') || (event._isGoReminders ? 'GoReminders' : 'Admin'),
                    service: extractFromDescription(desc, 'Service') || (event._isGoReminders ? 'GoReminders Appt' : 'General Appointment'),
                    length: extractFromDescription(desc, 'Duration') || '1 hour',
                    message: extractFromDescription(desc, 'Note') || (event._isGoReminders ? desc.substring(0, 150) : ''),
                    isLead: (event.colorId === '11')
                };
            }).filter(item => item !== null); 

            mappedAppointments.sort((a, b) => a.timestamp - b.timestamp);
            return res.status(200).json({ success: true, appointments: mappedAppointments });
        }

        if (req.method === 'DELETE') {
            const { id } = req.body;
            if (!id) return res.status(400).json({ success: false, error: 'No ID provided' });
            
            try { await calendar.events.delete({ calendarId: mainCalendarId, eventId: id }); } catch(e) {}
            try { await calendar.events.delete({ calendarId: goRemindersCalendarId, eventId: id }); } catch(e) {}
            
            return res.status(200).json({ success: true, message: 'Deleted successfully' });
        }

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
                try {
                    await calendar.events.update({ calendarId: mainCalendarId, eventId: newAppointment.id, requestBody: event });
                } catch (e) {
                    try { await calendar.events.update({ calendarId: goRemindersCalendarId, eventId: newAppointment.id, requestBody: event }); } catch(err) {}
                }
            } else {
                await calendar.events.insert({ calendarId: mainCalendarId, requestBody: event });
            }

            return res.status(200).json({ success: true, message: 'Saved successfully.' });
        }

        return res.status(405).json({ success: false, message: 'Method not allowed' });

    } catch (error) {
        console.error('Appointments API Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
