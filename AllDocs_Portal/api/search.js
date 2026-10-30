export const config = {
    api: {
        bodyParser: {
            sizeLimit: '20mb'
        }
    }
};

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID;
    const geminiKey = process.env.GEMINI_API_KEY;

    const DW_CSRF_TOKEN = process.env.DOCKETWISE_CSRF_TOKEN || "S2SIaBjTm3Al8iBwva92n1nhRwwpFyMfZF08ry5lEFR4x6JOZwG5PSGFWpA7MkfE09vFqUcpbSNlnwAWssHZjg";
    const DW_COOKIE = process.env.DOCKETWISE_COOKIE || "__stripe_mid=7a09a5c6-21ec-4d21-886d-c0bf6cc90d9760274d; intercom-device-id-q07v75s8=345a6aa1-5a77-4f02-afd1-47df40c5c1cd; browser.timezone=America/Los_Angeles; browser_id=a6350fa1-3722-4eac-9f81-3a34c6aa9572; _borderwise_session=8f901a47ce2fe3fc9898508ebf9b6160; intercom-session-q07v75s8=TnFLcXM3Q2RNcm9sRTRQTW5CazZjaGhQUllpU0NiVTQ0Yi84ekwvTDZwTEhjRHZqU2ZDdzNTTytzQWlsYjNPdDgzd3FiQk1idkhCa1cyb0FoRW9wRGkxekpHL3E3Y3MzVmlxbEVtaWo2SVkwckdsV1hSa1lPS0V6V3ROVEFNSEtTVWtnN3FHVDNkWUg5bnFXYnEwM2FGQnRvS1l3ZTYxaDloaGN0V052M2k4d1ErSEhwRlAwRTRHdkhacUUydW9MNFZtKzVoQTBxQUxzNFVQN1pweTZPVklSR0RjMG96b2NPMUVZdlJkdzZKSTBSQWl4NENHZlA3ZGFtS25yVFBEWjZnaU5admlzQWNHK1I1VFhSNkZSbzkvRDRpdCt4YXVjcDF1bUN4U1RQVlRyb3JOSjNzRUd3QmU3QnhkdGl0WEMtLUV6UmN5dVYvNzlkV3NiNi9TN0IvbXc9PQ==--f033a28c53b8aec83838622733173f9f2dc41aba; __stripe_sid=2cd489e7-9fc4-435a-bf3e-1632e9209388ae3582; per_page=50";

    // =========================================================================
    // РЕЖИМ POST: AI-СКАНИРОВАНИЕ ФАЙЛОВ КЛИЕНТА ИЗ DOCKETWISE ИЛИ КОМПЬЮТЕРА
    // =========================================================================
    if (req.method === 'POST') {
        try {
            if (!geminiKey) {
                return res.status(400).json({
                    success: false,
                    error: "GEMINI_API_KEY не найден в Vercel Environment Variables!"
                });
            }

            const { clientId, fileIds = [], uploadedFiles = [], clientName = '' } = req.body || {};
            const inlineParts = [];
            let textContext = `Client Name: ${clientName}\n`;

            // 1. Прикрепленные файлы с компьютера (если есть)
            if (Array.isArray(uploadedFiles)) {
                uploadedFiles.slice(0, 3).forEach(uf => {
                    if (uf.base64 && uf.mimeType) {
                        inlineParts.push({
                            inline_data: {
                                mime_type: uf.mimeType,
                                data: uf.base64
                            }
                        });
                    }
                });
            }

            // 2. Скачиваем отмеченные галочками файлы из Docketwise (до 4 файлов за раз, чтобы не превышать квоту токенов!)
            const uniqueDocIds = [...new Set(Array.isArray(fileIds) ? fileIds : [])].slice(0, 4);

            for (const docId of uniqueDocIds) {
                const candidateUrls = [
                    `https://app.docketwise.com/documents/${docId}/download`,
                    `https://app.docketwise.com/documents/${docId}`,
                    `https://app.docketwise.com/files/${docId}/download`
                ];
                for (const dUrl of candidateUrls) {
                    try {
                        const fRes = await fetch(dUrl, {
                            headers: {
                                "cookie": DW_COOKIE,
                                "x-csrf-token": DW_CSRF_TOKEN,
                                "Authorization": apiKey ? `Bearer ${apiKey}` : undefined,
                                "Referer": `https://app.docketwise.com/en/contacts/${clientId || ''}`
                            },
                            redirect: 'follow'
                        });
                        if (fRes.ok) {
                            const contentType = (fRes.headers.get('content-type') || '').toLowerCase();
                            if (contentType.includes('pdf') || contentType.includes('image') || contentType.includes('octet-stream')) {
                                const arrayBuf = await fRes.arrayBuffer();
                                // Берем файлы до 6 МБ, чтобы мгновенно проходить в бесплатную квоту Gemini
                                if (arrayBuf.byteLength > 400 && arrayBuf.byteLength < 6 * 1024 * 1024) {
                                    const b64 = Buffer.from(arrayBuf).toString('base64');
                                    let mime = 'application/pdf';
                                    if (contentType.includes('jpeg') || contentType.includes('jpg')) mime = 'image/jpeg';
                                    else if (contentType.includes('png')) mime = 'image/png';
                                    inlineParts.push({
                                        inline_data: { mime_type: mime, data: b64 }
                                    });
                                    break;
                                }
                            }
                        }
                    } catch (e) {}
                }
            }

            // 3. Собираем текстовую анкету и заметки клиента из Docketwise
            if (clientId) {
                try {
                    const cRes = await fetch(`https://app.docketwise.com/contacts/${clientId}.json`, {
                        headers: { "accept": "application/json", "cookie": DW_COOKIE, "x-csrf-token": DW_CSRF_TOKEN }
                    });
                    if (cRes.ok) {
                        const cJson = await cRes.json();
                        textContext += `Docketwise Contact Profile: ${JSON.stringify(cJson).slice(0, 6000)}\n`;
                    }
                } catch (e) {}

                try {
                    const notesRes = await fetch(`https://app.docketwise.com/en/contacts/${clientId}/notes`, {
                        headers: { "cookie": DW_COOKIE, "x-csrf-token": DW_CSRF_TOKEN }
                    });
                    if (notesRes.ok) {
                        const notesHtml = await notesRes.text();
                        const cleanNotes = notesHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 5000);
                        textContext += `Docketwise Client Notes: ${cleanNotes}\n`;
                    }
                } catch (e) {}
            }

            const systemPrompt = `You are an expert California Medi-Cal / IHSS / CAPI Legal Document Extraction AI.
Analyze all attached client documents (Driver's License, Birth Certificate, Passport, SSN Card, Medical Records, Visit Summaries, Prior Forms) and the Docketwise context.
If any document is in Armenian or Russian, translate all extracted values into English.
Infer gender ("Male" or "Female") from the documents or first name.
Do NOT confuse a doctor's or hospital's address with the applicant's home address.

Return ONLY valid JSON matching this exact structure (leave empty string "" if unknown):
{
  "firstName": "",
  "lastName": "",
  "otherNames": "",
  "ssn": "XXX-XX-XXXX",
  "dob": "MM/DD/YYYY",
  "gender": "Male or Female",
  "heightFt": "",
  "heightIn": "",
  "weight": "",
  "street": "",
  "city": "",
  "state": "CA",
  "zip": "",
  "phone": "",
  "language": "Armenian",
  "caseNum": "",
  "ssiApplied": "Yes or No",
  "ssiStatus": "Approved, Denied, Pending, On Appeal, or Unknown",
  "ssiDecisionDate": "MM/DD/YYYY",
  "diagnoses": [
    { "problem": "", "onsetDate": "MM/YYYY" }
  ],
  "clinics": [
    {
      "clinicName": "",
      "memberId": "",
      "doctorName": "",
      "address": "",
      "city": "",
      "state": "CA",
      "zip": "",
      "phone": "",
      "firstSeen": "MM/DD/YYYY",
      "lastSeen": "MM/DD/YYYY",
      "nextAppt": "MM/DD/YYYY",
      "reason": "",
      "medicines": "",
      "treatments": ""
    }
  ],
  "dailyLimitations": [
    "",
    "",
    "",
    ""
  ],
  "educationGrade": "",
  "educationDate": "MM/YYYY",
  "workedLast15Years": "Yes or No",
  "job": {
    "title": "",
    "business": "",
    "dateFrom": "MM/YYYY",
    "dateTo": "MM/YYYY",
    "hoursPerWeek": "",
    "rateOfPay": "",
    "description": ""
  }
}`;

            const requestParts = [{ text: systemPrompt + "\n\n" + textContext }, ...inlineParts];

            // Запрашиваем список доступных моделей для вашего ключа
            let availableModels = [];
            try {
                const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`);
                if (listRes.ok) {
                    const listData = await listRes.json();
                    availableModels = (listData.models || [])
                        .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
                        .map(m => m.name.replace('models/', ''));
                }
            } catch (e) {}

            // ВАЖНО: Сначала используем высоколимитные модели Flash (у которых огромная бесплатная квота и нет ошибки 429!),
            // а если первая модель вернет 429 — мгновенно переключаемся на следующую!
            const highQuotaOrder = [
                'gemini-2.5-flash',
                'gemini-2.0-flash',
                'gemini-2.0-flash-lite',
                'gemini-1.5-flash',
                'gemini-1.5-flash-8b',
                'gemini-2.5-pro'
            ];

            let modelsToTry = highQuotaOrder.filter(m => availableModels.includes(m));
            availableModels.forEach(m => {
                if (m.includes('gemini') && !modelsToTry.includes(m)) modelsToTry.push(m);
            });
            if (modelsToTry.length === 0) {
                modelsToTry = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
            }

            let aiJson = null;
            let usedModel = '';
            let lastErr = '';

            for (const modelName of modelsToTry.slice(0, 6)) {
                try {
                    const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: requestParts }],
                            generationConfig: {
                                temperature: 0.1,
                                responseMimeType: "application/json"
                            }
                        })
                    });

                    if (gRes.ok) {
                        const gData = await gRes.json();
                        const rawText = gData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
                        const cleaned = rawText.replace(/```json|```/g, '').trim();
                        aiJson = JSON.parse(cleaned);
                        usedModel = modelName;
                        break;
                    } else {
                        lastErr = await gRes.text();
                        // Если на модели с файлами превышен лимит 429, пробуем следующую модель в списке
                        continue;
                    }
                } catch (mErr) {
                    lastErr = mErr.message;
                }
            }

            // Если все модели вернули 429 из-за слишком тяжелых PDF, делаем легкий запрос по текстовому досье
            if (!aiJson && inlineParts.length > 0) {
                for (const fallbackModel of ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash']) {
                    try {
                        const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${fallbackModel}:generateContent?key=${geminiKey}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                contents: [{ parts: [requestParts[0], ...inlineParts.slice(0, 2)] }],
                                generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
                            })
                        });
                        if (gRes.ok) {
                            const gData = await gRes.json();
                            const rawText = gData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
                            aiJson = JSON.parse(rawText.replace(/```json|```/g, '').trim());
                            usedModel = fallbackModel;
                            break;
                        }
                    } catch (e) {}
                }
            }

            if (!aiJson) {
                throw new Error(`AI Scan error: ${lastErr.slice(0, 220)}`);
            }

            return res.status(200).json({
                success: true,
                model: usedModel,
                extracted: aiJson,
                filesScanned: inlineParts.length
            });

        } catch (error) {
            console.error("AI Scan Error:", error);
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    // =========================================================================
    // РЕЖИМ GET: ПОИСК КЛИЕНТА ИЛИ ЗАГРУЗКА ЕГО ДОСЬЕ И ФАЙЛОВ ИЗ ВКЛАДКИ FILES
    // =========================================================================
    const { query, type, clientId } = req.query;

    if (!apiKey) return res.status(500).json({ success: false, error: "Ключ не найден" });

    function classifyClientFile(fileName = '') {
        const lower = fileName.toLowerCase();
        if (/(zelle|receipt|invoice|payment|retainer|contract|check|bill_paid)/i.test(lower)) {
            return { category: 'ignore', badge: '💸 Ignore', priority: 0, autoSelect: false };
        }
        // Самый высокий приоритет (100): Права (Driver License), Паспорт, Свидетельство о рождении, SSN
        if (/(driver|license|dl|passport|birth|ssn|social|id_card|state_id|green_card|greencard|naturalization|medi-cal|bic)/i.test(lower)) {
            return { category: 'identity', badge: '🪪 ID / Personal', priority: 100, autoSelect: true };
        }
        // Приоритет 90: Медицинские выписки и формы MC 223 / SOC
        if (/(mc_223|mc223|mc 223|soc|873|804|814|453|839|medical|doctor|dr\.|clinic|hospital|meds|medication|rx|diagnosis|visit|summary|noa|ssi|capi|disability)/i.test(lower)) {
            return { category: 'medical_form', badge: '🩺 Medical / Form', priority: 90, autoSelect: true };
        }
        return { category: 'other', badge: '📄 Document', priority: 40, autoSelect: false };
    }

    if (clientId) {
        try {
            let contact = {};

            const r = await fetch(`https://app.docketwise.com/api/v1/contacts/${clientId}`, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
            });
            if (r.ok) {
                const d = await r.json();
                contact = d.contact || d.data || d || {};
            }

            try {
                const webRes = await fetch(`https://app.docketwise.com/contacts/${clientId}.json`, {
                    headers: {
                        "accept": "application/json",
                        "x-csrf-token": DW_CSRF_TOKEN,
                        "x-requested-with": "XMLHttpRequest",
                        "cookie": DW_COOKIE,
                        "Referer": `https://app.docketwise.com/en/contacts/${clientId}`
                    }
                });
                if (webRes.ok) {
                    const webData = await webRes.json();
                    const webContact = webData.contact || webData.data || webData || {};
                    contact = { ...contact, ...webContact };
                }
            } catch (e) {}

            let rawFiles = [];
            const embeddedDocs = contact.documents || contact.files || contact.attachments || [];
            if (Array.isArray(embeddedDocs)) {
                embeddedDocs.forEach(doc => {
                    const name = doc.title || doc.name || doc.file_name || doc.filename;
                    if (doc.id && name) {
                        rawFiles.push({
                            id: doc.id,
                            name: name,
                            url: doc.url || doc.download_url || `https://app.docketwise.com/documents/${doc.id}/download`
                        });
                    }
                });
            }

            const urlsToTry = [
                `https://app.docketwise.com/documents?client_id=${clientId}`,
                `https://app.docketwise.com/api/v1/documents?client_id=${clientId}`
            ];

            for (const docUrl of urlsToTry) {
                try {
                    const docRes = await fetch(docUrl, {
                        headers: {
                            "accept": "*/*;q=0.5, text/javascript, application/javascript, application/json",
                            "Authorization": apiKey ? `Bearer ${apiKey}` : undefined,
                            "x-csrf-token": DW_CSRF_TOKEN,
                            "x-requested-with": "XMLHttpRequest",
                            "cookie": DW_COOKIE,
                            "Referer": `https://app.docketwise.com/en/contacts/${clientId}`
                        }
                    });
                    if (!docRes.ok) continue;

                    const rawText = await docRes.text();
                    try {
                        const parsed = JSON.parse(rawText);
                        const arr = Array.isArray(parsed) ? parsed : (parsed.documents || parsed.files || parsed.data || []);
                        arr.forEach(item => {
                            const title = item.title || item.name || item.file_name || item.filename || `File #${item.id}`;
                            if (item.id && !rawFiles.some(f => String(f.id) === String(item.id))) {
                                rawFiles.push({
                                    id: item.id,
                                    name: title,
                                    url: item.url || item.download_url || `https://app.docketwise.com/documents/${item.id}/download`
                                });
                            }
                        });
                    } catch (notJson) {
                        const unescaped = rawText
                            .replace(/\\"/g, '"')
                            .replace(/\\'/g, "'")
                            .replace(/\\n/g, '\n')
                            .replace(/\\t/g, ' ')
                            .replace(/\\\//g, '/');

                        const linkRegex = /href=["']([^"']*\/(?:documents|files|attachments)\/(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
                        let match;
                        while ((match = linkRegex.exec(unescaped)) !== null) {
                            const href = match[1];
                            const id = match[2];
                            const innerText = match[3].replace(/<[^>]+>/g, '').trim();
                            if (innerText && innerText.length > 1 && !/^(edit|delete|trash|remove|download|view)$/i.test(innerText)) {
                                if (!rawFiles.some(f => String(f.id) === String(id))) {
                                    rawFiles.push({
                                        id: id,
                                        name: innerText,
                                        url: href.startsWith('http') ? href : `https://app.docketwise.com${href}`
                                    });
                                }
                            }
                        }
                    }
                } catch (e) {}
            }

            let classifiedFiles = rawFiles.map(f => {
                const meta = classifyClientFile(f.name);
                return { ...f, ...meta };
            }).sort((a, b) => b.priority - a.priority);

            // Автоматически ставим галочки только на 3 самых важных документах (например Driver License + Birth Certificate + Medical), чтобы сканирование шло мгновенно
            let autoSelectedCount = 0;
            classifiedFiles = classifiedFiles.map(f => {
                if (f.autoSelect && autoSelectedCount < 3) {
                    autoSelectedCount++;
                    return { ...f, autoSelect: true };
                }
                return { ...f, autoSelect: false };
            });

            let notesTextBlob = JSON.stringify(contact);
            const firstName = contact.first_name || (contact.name ? contact.name.split(' ')[0] : '') || '';
            const lastName = contact.last_name || (contact.name ? contact.name.split(' ').slice(1).join(' ') : '') || '';
            const middleName = contact.middle_name || '';
            const fullName = `${firstName} ${lastName}`.trim() || contact.name || '';
            const lastFirstMI = lastName ? `${lastName}, ${firstName}${middleName ? ' ' + middleName.charAt(0) : ''}` : fullName;

            let phone = contact.mobile_number || contact.home_number || contact.work_number || contact.phone || '';
            if (!phone && Array.isArray(contact.phone_numbers) && contact.phone_numbers.length > 0) {
                phone = contact.phone_numbers[0].number || contact.phone_numbers[0] || '';
            }

            const addrObj = contact.physical_address || contact.mailing_address || (Array.isArray(contact.addresses) ? contact.addresses[0] : {}) || {};
            let street = addrObj.street_number_and_name || addrObj.street || addrObj.address_1 || addrObj.line1 || contact.street_address || contact.address || '';
            const apt = addrObj.apartment_number || addrObj.apt || addrObj.suite || addrObj.address_2 || '';
            if (apt && street && !street.includes(apt)) street = `${street}, Apt ${apt}`;
            let city = addrObj.city || contact.city || 'Glendale';
            let state = addrObj.state || addrObj.province || contact.state || 'CA';
            let zip = addrObj.zip_code || addrObj.postal_code || addrObj.zip || contact.zip || '';

            let rawDob = contact.birthday || contact.date_of_birth || contact.dob || contact.birth_date || '';
            let formattedDob = rawDob;
            if (rawDob && /^\d{4}-\d{2}-\d{2}/.test(rawDob)) {
                const [yr, mo, dy] = rawDob.split('T')[0].split('-');
                formattedDob = `${mo}/${dy}/${yr}`;
            }

            let ssn = contact.ssn || contact.social_security_number || '';
            if (!ssn) {
                const ssnMatch = notesTextBlob.match(/\b(\d{3}-\d{2}-\d{4})\b/);
                if (ssnMatch) ssn = ssnMatch[1];
            }

            let gender = contact.gender || contact.sex || '';
            if (!gender && firstName) {
                const fn = firstName.toLowerCase();
                if (/(susanna|mariam|gohar|rima|lilit|anna|anahit|karine|narine|marine|gayane|hasmik|lusine|naira|varduhi|knarik|sirarpie|eda|emma|lena|svetlana|elena|olga|tatiana|natalia|irina|armine|seda|sona|nelly|meri|ani|mane|liana)$/i.test(fn)) {
                    gender = 'Female';
                } else if (/(petros|norayr|artak|argishti|armen|aram|karen|vahan|vahe|davtyan|david|tigran|gevorg|hayk|samvel|gagik|ashot|vigen|levon|ruben|artur|arthur|hovhannes|sargis|sevak|grigor|hakob|harutyun)$/i.test(fn)) {
                    gender = 'Male';
                }
            }

            const aNumber = contact.alien_number || contact.a_number || contact.uscis_number || '';
            const email = contact.email || (Array.isArray(contact.email_addresses) && contact.email_addresses[0]?.address) || '';
            const language = contact.primary_language || contact.language || 'Armenian';
            const heightFeet = contact.height_feet || '';
            const heightInches = contact.height_inches || '';
            const weight = contact.weight || '';

            return res.status(200).json({
                success: true,
                profile: {
                    id: clientId,
                    firstName,
                    lastName,
                    middleName,
                    fullName,
                    lastFirstMI,
                    phone,
                    email,
                    ssn,
                    aNumber,
                    dob: formattedDob,
                    gender,
                    street,
                    city,
                    state,
                    zip,
                    language,
                    heightFeet,
                    heightInches,
                    weight,
                    files: classifiedFiles
                }
            });
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }

    if (!query) return res.status(400).json({ success: false, error: "Пустой запрос" });

    const staffMap = {
        332487: "Norayr Badalyan",
        418892: "Petros Eghiazaryan",
        339159: "Mariam Djaradjian",
        332810: "Artak Badalyan",
        341318: "Rima Avetisyan",
        397654: "Gohar Aloyan",
        379998: "Nairi Hovhannisyan",
        445336: "Argishti Shahbazyan"
    };

    try {
        const rawQuery = query.toLowerCase().trim();
        let digits = rawQuery.replace(/\D/g, '');

        if (digits.length === 11 && digits.startsWith('1')) {
            digits = digits.substring(1);
        }

        const isPhoneSearch = type === 'phone' || (digits.length >= 4 && !/[a-zа-я]/i.test(rawQuery));
        let contacts = [];

        if (isPhoneSearch) {
            const fetchPromises = [];
            for (let page = 1; page <= 10; page++) {
                fetchPromises.push(
                    fetch(`https://app.docketwise.com/api/v1/contacts?per_page=500&page=${page}`, {
                        headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                    }).then(r => r.ok ? r.json() : { contacts: [] })
                );
            }

            const results = await Promise.all(fetchPromises);
            let allContacts = [];
            results.forEach(data => {
                allContacts = allContacts.concat(Array.isArray(data) ? data : (data.contacts || []));
            });

            contacts = allContacts.filter(c => {
                let phones = [];
                if (c.phone) phones.push(c.phone);
                if (c.mobile_number) phones.push(c.mobile_number);
                if (c.home_number) phones.push(c.home_number);
                if (c.work_number) phones.push(c.work_number);
                if (Array.isArray(c.phone_numbers)) {
                    c.phone_numbers.forEach(p => {
                        if (typeof p === 'string') phones.push(p);
                        else if (p && p.number) phones.push(p.number);
                    });
                }
                return phones.some(p => p.replace(/\D/g, '').includes(digits));
            });
        } else {
            const encodedQuery = encodeURIComponent(rawQuery);
            const response = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${encodedQuery}&per_page=100`, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                contacts = Array.isArray(data) ? data : (data.contacts || []);
            }
        }

        if (contacts.length === 0) return res.status(404).json({ success: false, error: "Клиенты не найдены" });

        const topMatches = contacts.slice(0, 15);

        const clientsData = await Promise.all(topMatches.map(async (contact) => {
            const fullName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || contact.name || "Unknown Name";
            
            let phoneStr = contact.mobile_number || contact.home_number || contact.work_number || contact.phone || "";
            if (!phoneStr && Array.isArray(contact.phone_numbers) && contact.phone_numbers.length > 0) {
                phoneStr = contact.phone_numbers[0].number || contact.phone_numbers[0] || "";
            }

            let mattersArray = [];
            try {
                const mattersRes = await fetch(`https://app.docketwise.com/api/v1/matters?client_id=${contact.id}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                });
                
                if (mattersRes.ok) {
                    const mattersData = await mattersRes.json();
                    const mattersList = Array.isArray(mattersData) ? mattersData : (mattersData.matters || []);
                    
                    mattersArray = await Promise.all(mattersList.map(async (m) => {
                        let staffName = "";
                        try {
                            const singleMatterRes = await fetch(`https://app.docketwise.com/api/v1/matters/${m.id}`, {
                                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                            });
                            if (singleMatterRes.ok) {
                                const singleData = await singleMatterRes.json();
                                const fullMatter = singleData.data || singleData.matter || singleData;
                                if (Array.isArray(fullMatter.user_ids) && fullMatter.user_ids.length > 0) {
                                    staffName = fullMatter.user_ids.map(id => staffMap[id] || `Staff (ID: ${id})`).join(", ");
                                }
                            }
                        } catch (err) {}

                        return { 
                            id: m.id, 
                            title: m.title || m.description || `Дело #${m.id}`,
                            assignee_name: staffName 
                        };
                    }));
                }
            } catch (e) {}

            return { id: contact.id, name: fullName, phone: phoneStr, matters: mattersArray };
        }));

        res.status(200).json({ success: true, clients: clientsData });
    } catch (error) {
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
}
