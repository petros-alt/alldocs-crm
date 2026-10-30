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

            const calendarsToFetch = [mainCalendarId, goRemindersCalendarId];

            // ⚡ УСКОРЕНИЕ В 2 РАЗА: Загружаем оба календаря параллельно одновременно!
            const results = await Promise.all(
                calendarsToFetch.filter(Boolean).map(async (calId) => {
                    try {
                        const response = await calendar.events.list({
                            calendarId: calId,
                            timeMin: minDate.toISOString(),
                            timeMax: maxDate.toISOString(),
                            singleEvents: true,
                            orderBy: 'startTime',
                        });
                        const items = response.data.items || [];
                        return items.map(ev => ({ ...ev, _isGoReminders: calId === goRemindersCalendarId }));
                    } catch (err) {
                        console.error(`Ошибка при чтении календаря ${calId}:`, err);
                        return [];
                    }
                })
            );
            const allEvents = results.flat();
            
            const mappedAppointments = allEvents.map(event => {
                const startDateTime = event.start?.dateTime || event.start?.date;
                const endDateTime = event.end?.dateTime || event.end?.date;
                if (!startDateTime) return null;

                const startDateObj = new Date(startDateTime);
                
                // ЖЕСТКО переводим время в часовой пояс Лос-Анджелеса
                const laDateStr = startDateObj.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
                const laDate = new Date(laDateStr);

                let hours = laDate.getHours();
                let minutes = laDate.getMinutes();
                const ampm = hours >= 12 ? 'PM' : 'AM';
                hours = hours % 12;
                hours = hours ? hours : 12; 
                const formattedTime = hours.toString().padStart(2, '0') + ':' + minutes.toString().padStart(2, '0') + ' ' + ampm;

                const desc = event.description || '';
                
                // ВЫЧИСЛЯЕМ ТОЧНУЮ ДЛИТЕЛЬНОСТЬ
                let calcLength = extractFromDescription(desc, 'Duration');
                if (!calcLength && startDateTime && endDateTime) {
                    const diffMs = new Date(endDateTime).getTime() - new Date(startDateTime).getTime();
                    const diffMins = Math.round(diffMs / 60000);
                    if (diffMins < 60) {
                        calcLength = `${diffMins} minutes`;
                    } else {
                        const hrs = Math.floor(diffMins / 60);
                        const rmins = diffMins % 60;
                        calcLength = `${hrs} hour${hrs > 1 ? 's' : ''}`;
                        if (rmins > 0) calcLength += ` ${rmins} minutes`;
                    }
                }
                if (!calcLength) calcLength = '1 hour';

                let clientName = event.summary || 'Unknown Client';
                let staffName = extractFromDescription(desc, 'Staff') || 'Admin';
                let serviceName = extractFromDescription(desc, 'Service') || 'General Appointment';
                let phoneNum = extractFromDescription(desc, 'Phone') || '';
                let noteMsg = extractFromDescription(desc, 'Note') || '';
                let loc = event.location || '';

                // ЧИТАЕМ КТО И КОГДА ПОСТАВИЛ АППОЙТМЕНТ
                let bookedBy = extractFromDescription(desc, 'Booked By') || '';
                let bookedAt = extractFromDescription(desc, 'Booked At') || '';

                // Если время создания не было записано в текст, берем системное время создания из самого Google Calendar
                if (!bookedAt && event.created) {
                    try {
                        const createdObj = new Date(event.created);
                        bookedAt = createdObj.toLocaleString('en-US', {
                            timeZone: 'America/Los_Angeles',
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                    } catch (e) {}
                }

                // УМНЫЙ ПАРСЕР ДЛЯ GOREMINDERS
                if (event._isGoReminders && event.summary) {
                    const summary = event.summary;
                    
                    const nMatch = summary.match(/^(.*?)(?:\s*@\s*|$)/);
                    if (nMatch) clientName = nMatch[1].trim();

                    const lMatch = summary.match(/@\s*(.*?)(?:\s*with\s*|$)/);
                    if (lMatch) loc = lMatch[1].trim() || loc;

                    const sMatch = summary.match(/with\s*(.*?)(?:\s*for\s*|$)/);
                    if (sMatch) staffName = sMatch[1].trim();

                    const srvMatch = summary.match(/for\s*(.*?)(?:\s*Customer Phone:|$)/);
                    if (srvMatch) serviceName = srvMatch[1].trim();

                    const phMatch = summary.match(/Customer Phone:\s*([\d\-\(\)\s]+)/);
                    if (phMatch) phoneNum = phMatch[1].trim();

                    const ntMatch = summary.match(/Appointment Notes:\s*(.*)$/i);
                    if (ntMatch) noteMsg = ntMatch[1].trim();
                    else if (desc && !noteMsg) noteMsg = desc; 

                    if (!bookedBy) bookedBy = 'GoReminders Sync';
                }

                return {
                    id: event.id, 
                    client: clientName,
                    dateStr: laDate.toDateString(), 
                    timestamp: startDateObj.getTime(),
                    time: formattedTime,
                    location: loc,
                    phone: phoneNum,
                    staff: staffName,
                    bookedBy: bookedBy || 'Admin / Front Desk',
                    bookedAt: bookedAt || '',
                    service: serviceName,
                    length: calcLength,
                    message: noteMsg,
                    isLead: (event.colorId === '11')
                };
            }).filter(item => item !== null); 

            mappedAppointments.sort((a, b) => a.timestamp - b.timestamp);

            return res.status(200).json({ success: true, appointments: mappedAppointments });
        }

        if (req.method === 'DELETE') {
            const { id } = req.body;
            if (!id) return res.status(400).json({ success: false, error: 'No ID provided' });
            
            // ⚡ Параллельное удаление без задержек
            await Promise.allSettled([
                calendar.events.delete({ calendarId: mainCalendarId, eventId: id }),
                calendar.events.delete({ calendarId: goRemindersCalendarId, eventId: id })
            ]);
            
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

            // Фиксируем кто создал/обновил и точное время по Лос-Анджелесу
            const operatorName = newAppointment.bookedBy || 'Staff Member';
            const nowLaStr = new Date().toLocaleString('en-US', {
                timeZone: 'America/Los_Angeles',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            const bookedAtTime = newAppointment.bookedAt || nowLaStr;

            const descText = `Phone: ${newAppointment.phone}\nService: ${newAppointment.service}\nStaff: ${newAppointment.staff}\nDuration: ${newAppointment.length}\nBooked By: ${operatorName}\nBooked At: ${bookedAtTime}\nNote: ${newAppointment.message || ''}\n\nBooked via CRM.`;

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
