export const config = {
    api: {
        bodyParser: {
            sizeLimit: '25mb'
        }
    },
    maxDuration: 60
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
    const DW_COOKIE = process.env.DOCKETWISE_COOKIE || "__stripe_mid=7a09a5c6-21ec-4d21-886d-c0bf6cc90d9760274d; intercom-device-id-q07v75s8=345a6aa1-5a77-4f02-afd1-47df40c5c1cd; browser.timezone=America/Los_Angeles; browser_id=a6350fa1-3722-4eac-9f81-3a34c6aa9572; _borderwise_session=8f901a47ce2fe3fc9898508ebf9b6160; per_page=50; __stripe_sid=2cd489e7-9fc4-435a-bf3e-1632e9209388ae3582; intercom-session-q07v75s8=azZPUnozMXp3VkJ2Q3RCaFRaSTZFWXFreWc1Q0FnZ0dGMkU3UTNkcEVJVjhDc3BSOXdOdXUvc05ONWZrenROczBiMTVXOWlYeEhId1hGcnNsQXdHR2F3ZlJoZ3ZWQzlqZUM0cEtEZHM5MXBWaGdvdGpiYnZtV05pdDI1Nms5dXJ4ZjZOUnNuMlpKdlZBUFZMY1pIaUQ3OEJkMitZQytxYkxqR3VqY3VqNm45d2wrOUx5eDBVN2ZRaTA3RGl2RnF3dFc0STlPZUxsOStXYnIwN3VGZDY1blp1Nkc2MGtkQnR2ODc1WDN2ek5xQStXY2E3Y09IV2J3bTFadXc5YmNuWDlpNXc3L3p6WlFwcTRkODZFUlpHTzgrcUlaNHBBSDhDNXFWU1MrbHNBbUdvVHVvM1ozb0tmd2dqV3YtLTVRTnlyWTVwb3lQbnpZakN5Yjh5SWc9PQ==--1000f00116b54aac3dc7cd422ad3bc993cea116d";

    async function fetchWithTimeout(url, options = {}, timeoutMs = 11000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timer);
            return response;
        } catch (err) {
            clearTimeout(timer);
            throw err;
        }
    }

    function detectRealMimeType(buffer) {
        if (!buffer || buffer.length < 8) return null;
        if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return 'application/pdf';
        if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
        if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45) return 'image/webp';
        return null;
    }

    function formatProperCase(str) {
        if (!str || typeof str !== 'string') return str;
        const trimmed = str.trim();
        if (!trimmed) return '';
        if (/^(n\/a|none|unknown|null|-)$/i.test(trimmed)) return '';
        if (/^\d/.test(trimmed) && !/[a-zA-Z]{3,}/.test(trimmed)) return trimmed;
        if (/^(CA|NY|TX|FL|NV|AZ|WA|OR|IL|PA|OH|GA|NC|MI|NJ|VA|MA|MD|SSI|SSDI|CAPI|IHSS|NOA|SOC|MC|USCIS|USA|PO|APT|STE|DR|ST|AVE|BLVD|RD|LN|CT|PL|NW|NE|SW|SE|II|III|IV|LLC|INC|MD|DO|RN|NP|PA-C|GED|12\+)$/i.test(trimmed)) {
            return trimmed.toUpperCase();
        }
        const upperCount = (trimmed.match(/[A-Z]/g) || []).length;
        const lowerCount = (trimmed.match(/[a-z]/g) || []).length;
        if ((upperCount > 2 && lowerCount === 0) || (lowerCount > 2 && upperCount === 0)) {
            return trimmed.toLowerCase().replace(/\b([a-z])([a-z']*)/g, (match, first, rest) => {
                const wordUp = match.toUpperCase();
                if (/^(CA|SSI|SSDI|CAPI|IHSS|NOA|MD|DO|RN|NP|LLC|INC|PO|II|III|IV|UCLA|USC|DMV|EDD|IRS|EKG|PFT|BNP|CBC|CMP|UTI|GED|EGFR)$/.test(wordUp)) {
                    return wordUp;
                }
                if (/^(and|or|of|in|on|at|to|for|with|from|by|the|a|an)$/.test(match) && match !== trimmed.toLowerCase().slice(0, match.length)) {
                    return match;
                }
                return first.toUpperCase() + rest;
            });
        }
        return trimmed;
    }

    function normalizeExtractedObject(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(item => normalizeExtractedObject(item));
        const out = {};
        for (const key of Object.keys(obj)) {
            const val = obj[key];
            if (typeof val === 'string') {
                if (/^(n\/a|none|unknown|null)$/i.test(val.trim()) && key !== 'otherNames') {
                    out[key] = '';
                } else if (key === 'state') {
                    out[key] = val.trim().toUpperCase() || 'CA';
                } else if (['ssn', 'dob', 'phone', 'zip', 'heightFt', 'heightIn', 'weight', 'caseNum', 'firstSeen', 'lastSeen', 'nextAppt', 'onsetDate', 'ssiDecisionDate', 'educationDate', 'educationGrade', 'dateFrom', 'dateTo', 'date'].includes(key)) {
                    out[key] = val.trim();
                } else {
                    out[key] = formatProperCase(val);
                }
            } else if (Array.isArray(val)) {
                out[key] = val.map(v => typeof v === 'string' ? formatProperCase(v) : normalizeExtractedObject(v));
            } else if (typeof val === 'object' && val !== null) {
                out[key] = normalizeExtractedObject(val);
            } else {
                out[key] = val;
            }
        }
        return out;
    }

    function parseDocketwiseDocumentsResponse(rawText, defaultMatterId = '') {
        const folders = [];
        const files = [];

        const unescaped = rawText
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'")
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, ' ')
            .replace(/\\\//g, '/');

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

        const rowBlocks = unescaped.split(/<tr/i);
        rowBlocks.forEach(tr => {
            if (tr.includes('folder_id=')) return;

            const idMatch =
                tr.match(/\/(?:documents|files|attachments)\/(\d+)/i) ||
                tr.match(/value=["'](\d+)["']/i) ||
                tr.match(/data-id=["'](\d+)["']/i) ||
                tr.match(/document[_-]id=["']?(\d+)/i);

            if (!idMatch) return;
            const docId = idMatch[1];
            if (files.some(x => String(x.id) === String(docId))) return;

            const dlMatch = tr.match(/href=["']([^"']*(?:download|amazonaws\.com|active_storage|\/documents\/\d+)[^"']*)["']/i);
            const directUrl = dlMatch
                ? (dlMatch[1].startsWith('http') ? dlMatch[1] : `https://app.docketwise.com${dlMatch[1]}`)
                : `https://app.docketwise.com/documents/${docId}`;

            const allCells = [...tr.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)]
                .map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim())
                .filter(Boolean);

            let bestFileName = '';
            const extCell = allCells.find(c => /\.(jpeg|jpg|pdf|png|doc|docx|heic)$/i.test(c));
            if (extCell) {
                bestFileName = extCell;
            } else {
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
        if (/(02\.|mc_223|mc223|mc 223|soc|873|804|814|453|839|medical|doctor|dr\.|clinic|hospital|meds|medication|rx|diagnosis|visit|summary|noa|ssi|capi|disability|pharmacy|discharge|lab|quest)/i.test(lower)) {
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

    async function downloadValidFileFromDocketwise(docId, customUrl, matterId, clientId) {
        const urlsToTry = [
            `https://app.docketwise.com/documents/${docId}/download`,
            `https://app.docketwise.com/documents/${docId}`
        ];
        if (customUrl && !urlsToTry.includes(customUrl)) urlsToTry.unshift(customUrl);

        for (const u of urlsToTry.slice(0, 2)) {
            try {
                const fRes = await fetchWithTimeout(u, {
                    headers: {
                        "cookie": DW_COOKIE,
                        "x-csrf-token": DW_CSRF_TOKEN,
                        "Referer": matterId ? `https://app.docketwise.com/en/matters/${matterId}` : `https://app.docketwise.com/en/contacts/${clientId || ''}`
                    },
                    redirect: 'follow'
                }, 5000);

                if (!fRes.ok) continue;

                const arrayBuf = await fRes.arrayBuffer();
                const buf = Buffer.from(arrayBuf);

                const detectedMime = detectRealMimeType(buf);
                if (detectedMime && buf.length < 9 * 1024 * 1024) {
                    return {
                        mime_type: detectedMime,
                        data: buf.toString('base64')
                    };
                }

                const textContent = buf.toString('utf8');
                const s3Regex = /(https:\/\/[^"'\s>]+(?:amazonaws\.com|cloudfront\.net|active_storage)[^"'\s>]*)|(\/rails\/active_storage\/[^"'\s>]+)/i;
                const s3Match = textContent.match(s3Regex);
                if (s3Match) {
                    const rawS3Url = s3Match[0].replace(/&amp;/g, '&').replace(/\\"/g, '');
                    const fullS3Url = rawS3Url.startsWith('http') ? rawS3Url : `https://app.docketwise.com${rawS3Url}`;
                    const s3Res = await fetchWithTimeout(fullS3Url, {
                        headers: rawS3Url.startsWith('http') ? {} : { "cookie": DW_COOKIE }
                    }, 5000);
                    if (s3Res.ok) {
                        const s3Buf = Buffer.from(await s3Res.arrayBuffer());
                        const s3Mime = detectRealMimeType(s3Buf);
                        if (s3Mime && s3Buf.length < 9 * 1024 * 1024) {
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

            if (Array.isArray(uploadedFiles)) {
                uploadedFiles.slice(0, 3).forEach(uf => {
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

            const uniqueDocIds = [...new Set(Array.isArray(fileIds) ? fileIds : [])].slice(0, 3);
            const downloadedParts = await Promise.all(
                uniqueDocIds.map((docId, idx) => {
                    const customUrl = Array.isArray(fileUrls) ? fileUrls[idx] : '';
                    return downloadValidFileFromDocketwise(docId, customUrl, matterId, clientId);
                })
            );
            downloadedParts.forEach(part => {
                if (part) inlineParts.push({ inline_data: part });
            });

            const systemPrompt = `You are an expert California Medi-Cal / Disability (Form MC 223) Clinical & Legal Document Synthesizer AI.
Analyze all attached raw client documents (Driver's License, Green Card, Social Security Card, Emergency Department Discharge Instructions, Pharmacy Patient History Reports, Clinic Visit Summaries, Lab Results from Quest Diagnostics / hospitals, or prior forms) for client "${clientName}".

CRITICAL RULES FOR SYNTHESIZING RAW DOCUMENTS INTO FORM MC 223:
1. HANDWRITING FILTER (WHAT TO READ vs WHAT TO IGNORE):
   - DO EXTRACT handwritten factual/medical data: handwritten medication names, dosages, doctor names, clinic addresses, phone numbers, diagnoses, onset dates, and checkmarks (☑ / ✓).
   - DO NOT EXTRACT signatures or signature dates: completely ignore handwritten signatures, initials, and dates written next to signatures in certification blocks.
2. NO ALL-CAPS: Convert ALL-CAPS text into clean Title Case. Keep medical/state abbreviations uppercase (CA, SSI, CAPI, IHSS, MD, NP, EKG, PFT, BNP, CBC, CMP, GED, eGFR).
3. ITEM 6 (DIAGNOSES):
   - Extract up to 4 primary disabling medical problems/diagnoses from the clinical records (e.g., "Nonspecific chest pain requiring emergency evaluation with elevated BNP", "Chronic macrocytic anemia secondary to drug therapy", "Moderate renal insufficiency with an eGFR of 47", "Active urinary tract infection due to E. coli") and their start/visit date in MM/YYYY format.
4. ITEM 7, 8, 9 (CLINICS, HOSPITALS & PHARMACY REPORTS):
   - Extract outpatient clinics and hospitals where the patient was treated (e.g., "All For Health, Health For All", "Glendale Medical Group Inc").
   - For each clinic, extract: clinicName, memberId (patient account/member number), doctorName (e.g. "Anna Karagyan, NP", "Noralie Raudszus, NP"), address, city, state, zip, phone, firstSeen (MM/DD/YYYY), lastSeen (MM/DD/YYYY), reason for visit, overnightStay ("Yes" or "No"), emergencyRoom ("Yes" or "No"), medicines (list medications & dosages from Pharmacy Reports or visit notes), and treatments (list labs/panels/procedures and dates).
   - Note: If a hospital (like "Dignity Health - Glendale Memorial Hospital") or lab (like "Quest Diagnostics") was ONLY used for diagnostic tests (EKG, Chest X-ray, Blood tests, 24-hour urine), put it into the "tests" object (Item 10) rather than duplicating it in Item 9, unless it was a separate doctor consultation.
5. ITEM 10 (MEDICAL TESTS TABLE - PAGE 3):
   - Check the medical records for any of these 6 tests:
     * ekg (Electrocardiogram / EKG)
     * treadmill (Treadmill exercise heart test)
     * chestXray (Chest X-ray)
     * breathing (Breathing Test / PFT)
     * blood (Blood Tests / CBC / CMP / Lipid / HbA1c / Quest Diagnostics)
     * other (Other test, e.g. 24-hour urine StoneRisk panel / Urinalysis / Ultrasound)
   - If a test WAS performed in the medical records, set "performed": "Yes" and fill in the facility "name" (e.g. "Dignity Health - Glendale Memorial Hospital" or "Quest Diagnostics / Glendale Medical Group"), "address", "city", "state", "zip", and "date" (MM/YYYY).
6. ITEM 14 (DAILY ACTIVITIES LIMITATIONS):
   - Based on the clinical diagnoses, medications, and discharge instructions, provide up to 4 concise, medically accurate sentences describing how the condition limits daily activities (e.g., "Severe fatigue and weakness from anemia limit my physical stamina.", "Medical orders restrict lifting over 10 lbs due to chest pain.", "Stage 3 kidney disease and stone risk cause constant discomfort.", "Daily activities are restricted by exhaustion and medication side effects.").

Return ONLY valid JSON matching this exact structure (use empty string "" if not mentioned in these specific files):
{
  "firstName": "",
  "lastName": "",
  "otherNames": "",
  "ssn": "",
  "dob": "",
  "gender": "",
  "heightFt": "",
  "heightIn": "",
  "weight": "",
  "street": "",
  "city": "",
  "state": "",
  "zip": "",
  "phone": "",
  "language": "",
  "caseNum": "",
  "ssiApplied": "",
  "ssiStatus": "",
  "ssiDecisionDate": "",
  "ssiWorsened": "",
  "ssiNewProblem": "",
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
      "overnightStay": "",
      "overnightDates": "",
      "emergencyRoom": "",
      "erDates": "",
      "medicines": "",
      "treatments": ""
    }
  ],
  "tests": {
    "ekg": { "performed": "", "name": "", "address": "", "city": "", "state": "CA", "zip": "", "date": "MM/YYYY" },
    "treadmill": { "performed": "", "name": "", "address": "", "city": "", "state": "CA", "zip": "", "date": "MM/YYYY" },
    "chestXray": { "performed": "", "name": "", "address": "", "city": "", "state": "CA", "zip": "", "date": "MM/YYYY" },
    "breathing": { "performed": "", "name": "", "address": "", "city": "", "state": "CA", "zip": "", "date": "MM/YYYY" },
    "blood": { "performed": "", "name": "", "address": "", "city": "", "state": "CA", "zip": "", "date": "MM/YYYY" },
    "other": { "performed": "", "name": "", "address": "", "city": "", "state": "CA", "zip": "", "date": "MM/YYYY" }
  },
  "otherMedicalTreatment11": "",
  "willingAdditionalExam": "",
  "dailyLimitations": [],
  "educationGrade": "",
  "educationDate": "",
  "specialEd": "",
  "workedLast15Years": "",
  "job": {
    "title": "",
    "business": "",
    "dateFrom": "",
    "dateTo": "",
    "hoursPerWeek": "",
    "rateOfPay": "",
    "description": ""
  }
}`;

            const requestParts = [{ text: systemPrompt + "\n\n" + textContext }, ...inlineParts];

            const modelsPool = [
                'gemini-2.0-flash',
                'gemini-flash-lite-latest',
                'gemini-2.0-flash-lite',
                'gemini-2.5-flash'
            ];

            let aiJson = null;
            let usedModel = '';
            let lastErr = '';

            for (const modelName of modelsPool) {
                try {
                    const genConfig = { temperature: 0.05 };
                    if (modelName.includes('2.5')) {
                        genConfig.thinkingConfig = { thinkingBudget: 0 };
                    }

                    const gRes = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: requestParts }],
                            generationConfig: genConfig
                        })
                    }, 12000);

                    if (gRes.ok) {
                        const gData = await gRes.json();
                        const partsArr = gData.candidates?.[0]?.content?.parts || [];
                        const textPart = partsArr.find(p => p.text && p.text.includes('{')) || partsArr[partsArr.length - 1] || {};
                        const rawText = textPart.text || '{}';
                        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
                        const cleaned = jsonMatch ? jsonMatch[0] : rawText.replace(/```json|```/g, '').trim();
                        aiJson = normalizeExtractedObject(JSON.parse(cleaned));
                        usedModel = modelName;
                        break;
                    } else {
                        lastErr = await gRes.text();
                        continue;
                    }
                } catch (mErr) {
                    lastErr = mErr.name === 'AbortError' ? `${modelName} timeout` : mErr.message;
                }
            }

            if (!aiJson) {
                throw new Error(`AI Scan busy: ${lastErr.slice(0, 140)}`);
            }

            return res.status(200).json({
                success: true,
                model: usedModel,
                extracted: aiJson,
                filesScanned: inlineParts.length
            });

        } catch (error) {
            console.error("AI Scan Error:", error);
            return res.status(500).json({ success: false, error: error.message || "AI Scan failed" });
        }
    }

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
                    /(00\.|01\.|02\.|04\.|05\.|07\.|personal|medical|upload|inbox|education|work|financial|final|packet)/i.test(fld.name)
                ).slice(0, 6);

                const foldersToScan = keyFolders.length > 0 ? keyFolders : parsed.folders.slice(0, 5);

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
            const firstName = formatProperCase(contact.first_name || (contact.name ? contact.name.split(' ')[0] : '') || '');
            const lastName = formatProperCase(contact.last_name || (contact.name ? contact.name.split(' ').slice(1).join(' ') : '') || '');
            const middleName = formatProperCase(contact.middle_name || '');
            const fullName = `${firstName} ${lastName}`.trim() || formatProperCase(contact.name || '');
            const lastFirstMI = lastName ? `${lastName}, ${firstName}${middleName ? ' ' + middleName.charAt(0) : ''}` : fullName;

            let phone = contact.mobile_number || contact.home_number || contact.work_number || contact.phone || '';
            if (!phone && Array.isArray(contact.phone_numbers) && contact.phone_numbers.length > 0) {
                phone = contact.phone_numbers[0].number || contact.phone_numbers[0] || '';
            }

            const addrObj = contact.physical_address || contact.mailing_address || (Array.isArray(contact.addresses) ? contact.addresses[0] : {}) || {};
            let street = formatProperCase(addrObj.street_number_and_name || addrObj.street || addrObj.address_1 || addrObj.line1 || contact.street_address || contact.address || '');
            const apt = formatProperCase(addrObj.apartment_number || addrObj.apt || addrObj.suite || addrObj.address_2 || '');
            if (apt && street && !street.toLowerCase().includes(apt.toLowerCase())) street = `${street}, Apt ${apt}`;
            let city = formatProperCase(addrObj.city || contact.city || 'Glendale');
            let state = (addrObj.state || addrObj.province || contact.state || 'CA').toUpperCase();
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
                } else if (/(petros|norayr|artak|argishti|armen|aram|karen|vahan|vahe|davtyan|david|tigran|gevorg|hayk|samvel|gagik|ashot|vigen|levon|ruben|artur|arthur|hovhannes|sargis|sevak|grigor|hakob|harutyun|yurik)$/i.test(fn)) {
                    gender = 'Male';
                }
            }

            const aNumber = contact.alien_number || contact.a_number || contact.uscis_number || '';
            const email = contact.email || (Array.isArray(contact.email_addresses) && contact.email_addresses[0]?.address) || '';
            const language = formatProperCase(contact.primary_language || contact.language || 'Armenian');
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
            const fullName = formatProperCase(`${contact.first_name || ''} ${contact.last_name || ''}`.trim() || contact.name || "Unknown Name");
            
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
