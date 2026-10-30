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

    const DW_CSRF_TOKEN = process.env.DOCKETWISE_CSRF_TOKEN || "hPvfgqHTOcjZGfr3rB46I8l0h2G_U0_zPe__5rzApxK3WPWk3gEbhd1ugBcqgwt4Q04FxNFtAc88LcNfIGRuyA";
    const DW_COOKIE = process.env.DOCKETWISE_COOKIE || "__stripe_mid=7a09a5c6-21ec-4d21-886d-c0bf6cc90d9760274d; intercom-device-id-q07v75s8=345a6aa1-5a77-4f02-afd1-47df40c5c1cd; browser.timezone=America/Los_Angeles; browser_id=a6350fa1-3722-4eac-9f81-3a34c6aa9572; _borderwise_session=8f901a47ce2fe3fc9898508ebf9b6160; per_page=50; __stripe_sid=2cd489e7-9fc4-435a-bf3e-1632e9209388ae3582; intercom-session-q07v75s8=azZPUnozMXp3VkJ2Q3RCaFRaSTZFWXFreWc1Q0FnZ0dGMkU3UTNkcEVJVjhDc3BSOXdOdXUvc05ONWZrenROczBiMTVXOWlYeEhId1hGcnNsQXdHR2F3ZlJoZ3ZWQzlqZUM0cEtEZHM5MXBWaGdvdGpiYnZtV05pdDI1Nms5dXJ4ZjZOUnNuMlpKdlZBUFZMY1pIaUQ3OEJkMitZQytxYkxqR3VqY3VBWk1XaS9qNm45d2wrOUx5eDBVN2ZRaTA3RGl2RnF3dFc0STlPZUxsOStXYnIwN3VGZDY1blp1Nkc2MGtkQnR2ODc1WDN2ek5xQStXY2E3Y09IV2J3bTFadXc5YmNuWDlpNXc3L3p6WlFwcTRkODZFUlpHTzgrcUlaNHBBSDhDNXFWU1MrbHNBbUdvVHVvM1ozb0tmd2dqV3YtLTVRTnlyWTVwb3lQbnpZakN5Yjh5SWc9PQ==--1000f00116b54aac3dc7cd422ad3bc993cea116d";

    // Определение настоящего типа файла (PDF / JPEG / PNG) по его первым байтам (Magic Bytes)
    function detectRealMimeType(buffer) {
        if (!buffer || buffer.length < 8) return null;
        // %PDF (25 50 44 46)
        if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
            return 'application/pdf';
        }
        // JPEG (FF D8 FF)
        if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
            return 'image/jpeg';
        }
        // PNG (89 50 4E 47)
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
            return 'image/png';
        }
        // WEBP (RIFF....WEBP)
        if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45) {
            return 'image/webp';
        }
        return null;
    }

    // Точный парсер папок и оригинальных названий файлов из таблицы Docketwise
    function parseDocketwiseDocumentsResponse(rawText, defaultMatterId = '') {
        const folders = [];
        const files = [];

        const unescaped = rawText
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'")
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, ' ')
            .replace(/\\\//g, '/');

        // 1. Ищем все ПАПКИ (folder_id=...)
        const folderRegex = /href=["']([^"']*folder_id=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let fMatch;
        while ((fMatch = folderRegex.exec(unescaped)) !== null) {
            const href = fMatch[1];
            const folderId = fMatch[2];
            const mIdMatch = href.match(/matter_id=(\d+)/i);
            const mId = mIdMatch ? mIdMatch[1] : defaultMatterId;
            const title = fMatch[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

            if (title && title.length > 1 && !folders.some(x => String(x.folderId) === String(folderId))) {
                folders.push({
                    folderId: folderId,
                    matterId: mId,
                    name: title
                });
            }
        }

        // 2. Разбираем каждую строку <tr> таблицы файлов, чтобы достать ТОЧНОЕ ОРИГИНАЛЬНОЕ ИМЯ из колонки Name!
        const rowBlocks = unescaped.split(/<tr/i);
        rowBlocks.forEach(tr => {
            if (tr.includes('folder_id=')) return;

            // Ищем ID документа в строке (из ссылки скачивания, просмотра, чекбокса или кнопки Delete /documents/12345)
            const idMatch =
                tr.match(/\/(?:documents|files|attachments)\/(\d+)/i) ||
                tr.match(/value=["'](\d+)["']/i) ||
                tr.match(/data-id=["'](\d+)["']/i) ||
                tr.match(/document[_-]id=["']?(\d+)/i);

            if (!idMatch) return;
            const docId = idMatch[1];
            if (files.some(x => String(x.id) === String(docId))) return;

            // Ищем прямую ссылку на скачивание внутри этой строки (если есть)
            const dlMatch = tr.match(/href=["']([^"']*(?:download|amazonaws\.com|\/documents\/\d+\/[^"']*))["']/i);
            const directUrl = dlMatch
                ? (dlMatch[1].startsWith('http') ? dlMatch[1] : `https://app.docketwise.com${dlMatch[1]}`)
                : `https://app.docketwise.com/documents/${docId}`;

            // Вытаскиваем все ячейки строки (И <th>, И <td>!), так как колонка Name часто лежит в <th> или первой ячейке
            const allCells = [...tr.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)]
                .map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim())
                .filter(Boolean);

            let bestFileName = '';

            // Сначала ищем ячейку, где есть расширение файла (.jpeg, .jpg, .pdf, .png, .doc)
            const extCell = allCells.find(c => /\.(jpeg|jpg|pdf|png|doc|docx|heic)$/i.test(c));
            if (extCell) {
                bestFileName = extCell;
            } else {
                // Иначе берем первую осмысленную текстовую ячейку, которая НЕ является числом размера (0.35, 0.22) и НЕ является датой или email
                const textCell = allCells.find(c =>
                    c.length > 2 &&
                    !/^\d+(\.\d+)?(\s*(mb|kb|bytes))?$/i.test(c) &&
                    !/^\d{2}\/\d{2}\/\d{2,4}$/.test(c) &&
                    !c.includes('@') &&
                    !/^(delete|edit|download|view|actions|name|size)$/i.test(c)
                );
                if (textCell) bestFileName = textCell;
            }

            if (bestFileName) {
                files.push({
                    id: docId,
                    name: bestFileName,
                    url: directUrl
                });
            }
        });

        return { folders, files };
    }

    function classifyClientFile(fileName = '', folderName = '') {
        const lower = (fileName + ' ' + folderName).toLowerCase();
        if (/(zelle|receipt|invoice|payment|retainer|contract|08\.\s*firm)/i.test(lower)) {
            return { category: 'ignore', badge: '💸 Contract/Fee', priority: 10, autoSelect: false };
        }
        if (/(01\.|personal|identification|driver|license|dl|passport|birth|ssn|social|id_card|state_id|green_card|greencard|permanent resident|naturalization|medi-cal|bic)/i.test(lower)) {
            return { category: 'identity', badge: '🪪 01. Personal ID', priority: 100, autoSelect: true };
        }
        if (/(02\.|mc_223|mc223|mc 223|soc|873|804|814|453|839|medical|doctor|dr\.|clinic|hospital|meds|medication|rx|diagnosis|visit|summary|noa|ssi|capi|disability)/i.test(lower)) {
            return { category: 'medical_form', badge: '🩺 02. Medical', priority: 95, autoSelect: true };
        }
        if (/(04\.|education|work|job|employment|school)/i.test(lower)) {
            return { category: 'work_edu', badge: '🏫 04. Edu/Work', priority: 85, autoSelect: true };
        }
        if (/(05\.|financial|living|bank|lease|rent|utility|expense)/i.test(lower)) {
            return { category: 'financial', badge: '💰 05. Financials', priority: 80, autoSelect: false };
        }
        return { category: 'other', badge: '📄 Document', priority: 50, autoSelect: true };
    }

    // Функция надежного скачивания файла из Docketwise с проверкой Magic Bytes (PDF / JPEG / PNG)
    async function downloadValidFileFromDocketwise(docId, customUrl, matterId, clientId) {
        const urlsToTry = [
            customUrl,
            `https://app.docketwise.com/documents/${docId}/download`,
            `https://app.docketwise.com/documents/${docId}`,
            `https://app.docketwise.com/en/documents/${docId}`,
            `https://app.docketwise.com/files/${docId}/download`
        ].filter(Boolean);

        for (const u of [...new Set(urlsToTry)]) {
            try {
                const fRes = await fetch(u, {
                    headers: {
                        "cookie": DW_COOKIE,
                        "x-csrf-token": DW_CSRF_TOKEN,
                        "Authorization": apiKey ? `Bearer ${apiKey}` : undefined,
                        "Referer": matterId ? `https://app.docketwise.com/en/matters/${matterId}` : `https://app.docketwise.com/en/contacts/${clientId || ''}`
                    },
                    redirect: 'follow'
                });

                if (!fRes.ok) continue;

                const arrayBuf = await fRes.arrayBuffer();
                const buf = Buffer.from(arrayBuf);

                // Проверяем первые байты: это настоящий PDF, JPEG или PNG?
                const detectedMime = detectRealMimeType(buf);
                if (detectedMime && buf.length < 10 * 1024 * 1024) {
                    return {
                        mime_type: detectedMime,
                        data: buf.toString('base64')
                    };
                }

                // Если Docketwise вернул HTML/JS страницу предпросмотра, ищем внутри неё прямую ссылку на S3 (amazonaws.com) или /rails/active_storage/...
                const textContent = buf.toString('utf8');
                const s3Regex = /(https:\/\/[^"'\s>]+(?:amazonaws\.com|cloudfront\.net|active_storage)[^"'\s>]*)|(\/rails\/active_storage\/[^"'\s>]+)/i;
                const s3Match = textContent.match(s3Regex);
                if (s3Match) {
                    const rawS3Url = s3Match[0].replace(/&amp;/g, '&').replace(/\\"/g, '');
                    const fullS3Url = rawS3Url.startsWith('http') ? rawS3Url : `https://app.docketwise.com${rawS3Url}`;
                    const s3Res = await fetch(fullS3Url, {
                        headers: rawS3Url.startsWith('http') ? {} : { "cookie": DW_COOKIE }
                    });
                    if (s3Res.ok) {
                        const s3Buf = Buffer.from(await s3Res.arrayBuffer());
                        const s3Mime = detectRealMimeType(s3Buf);
                        if (s3Mime && s3Buf.length < 10 * 1024 * 1024) {
                            return {
                                mime_type: s3Mime,
                                data: s3Buf.toString('base64')
                            };
                        }
                    }
                }
            } catch (e) {}
        }
        return null;
    }

    // =========================================================================
    // РЕЖИМ POST: AI-СКАНИРОВАНИЕ ВЫБРАННЫХ ФАЙЛОВ КЛИЕНТА ЧЕРЕЗ GEMINI VISION
    // =========================================================================
    if (req.method === 'POST') {
        try {
            if (!geminiKey) {
                return res.status(400).json({
                    success: false,
                    error: "GEMINI_API_KEY не найден в Vercel Environment Variables!"
                });
            }

            const { clientId, matterId = '', fileIds = [], fileUrls = [], uploadedFiles = [], clientName = '' } = req.body || {};
            const inlineParts = [];
            let textContext = `Target Client Full Name: ${clientName}\nIMPORTANT: Extract data ONLY for ${clientName}!\n`;

            // 1. Прикрепленные локальные файлы с компьютера (проверяем их реальный тип по первым байтам!)
            if (Array.isArray(uploadedFiles)) {
                uploadedFiles.slice(0, 4).forEach(uf => {
                    if (uf.base64) {
                        const rawBuf = Buffer.from(uf.base64, 'base64');
                        const realMime = detectRealMimeType(rawBuf) || uf.mimeType || 'image/jpeg';
                        inlineParts.push({
                            inline_data: {
                                mime_type: realMime,
                                data: uf.base64
                            }
                        });
                    }
                });
            }

            // 2. Скачиваем отмеченные галочками файлы из выбранного Matter / Папки в Docketwise
            const uniqueDocIds = [...new Set(Array.isArray(fileIds) ? fileIds : [])].slice(0, 5);
            for (let i = 0; i < uniqueDocIds.length; i++) {
                const docId = uniqueDocIds[i];
                const customUrl = Array.isArray(fileUrls) ? fileUrls[i] : '';
                const validFilePart = await downloadValidFileFromDocketwise(docId, customUrl, matterId, clientId);
                if (validFilePart) {
                    inlineParts.push({ inline_data: validFilePart });
                }
            }

            // 3. Добавляем текстовый профиль и заметки клиента из Docketwise
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
            }

            const systemPrompt = `You are an expert California Medi-Cal / IHSS / CAPI Legal Document Extraction AI.
Analyze all attached client documents (California Driver's License, Permanent Resident Card / Green Card, Social Security Card, Medi-Cal Card, Passport, Birth Certificate, Medical Records, Visit Summaries, Prescriptions, Prior MC 223 / SOC forms) and the Docketwise context for client "${clientName}".
If any document is in Armenian or Russian, translate all extracted values into English.
From California Driver's License or Green Card: carefully extract Date of Birth (DOB in MM/DD/YYYY), Sex (M -> Male, F -> Female), Height (HGT, e.g. 5'-04" -> heightFt: "5", heightIn: "4"), Weight (WGT in lbs -> weight: "155"), Home Address, and A-Number (USCIS#).
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

            const highQuotaOrder = [
                'gemini-2.5-flash',
                'gemini-2.0-flash',
                'gemini-2.0-flash-lite',
                'gemini-1.5-flash',
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

            for (const modelName of modelsToTry.slice(0, 5)) {
                try {
                    const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: requestParts }],
                            generationConfig: {
                                temperature: 0.1
                            }
                        })
                    });

                    if (gRes.ok) {
                        const gData = await gRes.json();
                        const rawText = gData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
                        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
                        const cleaned = jsonMatch ? jsonMatch[0] : rawText.replace(/```json|```/g, '').trim();
                        aiJson = JSON.parse(cleaned);
                        usedModel = modelName;
                        break;
                    } else {
                        lastErr = await gRes.text();
                    }
                } catch (mErr) {
                    lastErr = mErr.message;
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
    // РЕЖИМ GET: ПОЛУЧЕНИЕ ПАПОК И ФАЙЛОВ ПО ВЫБРАННОМУ MATTER ИЛИ ПАПКЕ
    // =========================================================================
    const { query, type, clientId, matterId, folderId } = req.query;

    if (!apiKey) return res.status(500).json({ success: false, error: "Ключ не найден" });

    if (matterId || folderId) {
        try {
            let targetUrl = `https://app.docketwise.com/documents?matter_id=${matterId || ''}`;
            if (folderId && folderId !== 'ALL_KEY_FOLDERS') {
                targetUrl = `https://app.docketwise.com/documents?folder_id=${folderId}&matter_id=${matterId || ''}`;
            }

            const docRes = await fetch(targetUrl, {
                headers: {
                    "accept": "*/*;q=0.5, text/javascript, application/javascript",
                    "x-csrf-token": DW_CSRF_TOKEN,
                    "x-requested-with": "XMLHttpRequest",
                    "cookie": DW_COOKIE,
                    "Referer": `https://app.docketwise.com/en/matters/${matterId || ''}`
                }
            });

            const rawText = await docRes.text();
            const parsed = parseDocketwiseDocumentsResponse(rawText, matterId);

            let allFiles = parsed.files.map(f => ({
                ...f,
                folderName: 'Root',
                ...classifyClientFile(f.name, '')
            }));

            if ((!folderId || folderId === 'ALL_KEY_FOLDERS') && parsed.folders.length > 0) {
                const keyFolders = parsed.folders.filter(fld =>
                    /(00\.|01\.|02\.|04\.|05\.|personal|medical|upload|inbox|education|work|financial)/i.test(fld.name)
                ).slice(0, 5);

                const foldersToScan = keyFolders.length > 0 ? keyFolders : parsed.folders.slice(0, 4);

                const subResults = await Promise.all(foldersToScan.map(async (fld) => {
                    try {
                        const subUrl = `https://app.docketwise.com/documents?folder_id=${fld.folderId}&matter_id=${matterId}`;
                        const subRes = await fetch(subUrl, {
                            headers: {
                                "accept": "*/*;q=0.5, text/javascript, application/javascript",
                                "x-csrf-token": DW_CSRF_TOKEN,
                                "x-requested-with": "XMLHttpRequest",
                                "cookie": DW_COOKIE,
                                "Referer": `https://app.docketwise.com/en/matters/${matterId}`
                            }
                        });
                        const subText = await subRes.text();
                        const subParsed = parseDocketwiseDocumentsResponse(subText, matterId);
                        return subParsed.files.map(f => ({
                            ...f,
                            folderId: fld.folderId,
                            folderName: fld.name,
                            ...classifyClientFile(f.name, fld.name)
                        }));
                    } catch (e) {
                        return [];
                    }
                }));

                subResults.forEach(arr => {
                    arr.forEach(fileItem => {
                        if (!allFiles.some(existing => String(existing.id) === String(fileItem.id))) {
                            allFiles.push(fileItem);
                        }
                    });
                });
            }

            allFiles.sort((a, b) => b.priority - a.priority);

            let checkedCount = 0;
            allFiles = allFiles.map(f => {
                if (f.autoSelect && checkedCount < 4) {
                    checkedCount++;
                    return { ...f, autoSelect: true };
                }
                return { ...f, autoSelect: false };
            });

            return res.status(200).json({
                success: true,
                folders: parsed.folders,
                files: allFiles
            });
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
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
                    weight
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
