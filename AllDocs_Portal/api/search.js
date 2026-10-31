import zlib from 'zlib';

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

    const DW_CSRF_TOKEN = process.env.DOCKETWISE_CSRF_TOKEN || "8BNcjQ7ckoI2oPKCgzHgHFNZhCJ_LCKRY0a_xZ5UlXTMynTDvIcxZujXwKxSRkTh8so-Nhfvk4hXxrYhPaESZQ";
    const DW_COOKIE = process.env.DOCKETWISE_COOKIE || "__stripe_mid=7a09a5c6-21ec-4d21-886d-c0bf6cc90d9760274d; intercom-device-id-q07v75s8=345a6aa1-5a77-4f02-afd1-47df40c5c1cd; browser.timezone=America/Los_Angeles; browser_id=a6350fa1-3722-4eac-9f81-3a34c6aa9572; __stripe_sid=db75ef5c-3bed-481d-9646-b4fa6b7120d7837c9b; _borderwise_session=3cd68d33a3298f02414dfeed80b24a7e; intercom-session-q07v75s8=Y2wyUktEcHdjME4xL3RlSUp5U0p5M1owRy9YV2lIYThVWnBBd0dwbDBlQTZIekhJTU8yeFpXbGtyOE1XZ2lrcjRiRnowR01QdHYxZ1NLY2d2amY4RnRGSWNmSmNnTFR0MktyaDBwWm4xTURoM2RaOGQ5QjZBS2FaYXhjTG1UZTVRMW1IZXVyY1pIWEJjWnJTejZzK0d5eHp2NS9BazNiM1lUWFZjMzBvOUQzVTViRnlOS2hQaXFCWkNoSVhucmRZaHlzSjlEYUcrYTVTQjFjT3VPL3pydm5RS1VVdXFTdlRSSno2VDhtckRRZ1FrUzRtVERET0JjWEpxQWZVdlAvVm5tYWI4VkptQytTOXg0eldiY2ErVGZRWDJQc0R1MU8wT002a24xMGhIZHBRc3ZobDJNMVo4N0NoRkVKWGtqZ2wtLTZseUd5YUl4aldKQWt6M2oyVnYycFE9PQ==--9c23d3dc99d36c1984ef5b20403ef28fd3ce561c";

    async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
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
        // PK.. ZIP header — это файл Microsoft Word (.docx)
        if (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        return null;
    }

    // Встроенный распаковщик текста из файлов Microsoft Word (.docx) без внешних библиотек!
    function extractTextFromDocxBuffer(buf) {
        try {
            let offset = 0;
            const extractedChunks = [];
            while (offset + 30 < buf.length) {
                if (buf.readUInt32LE(offset) !== 0x04034b50) {
                    offset++;
                    continue;
                }
                const compression = buf.readUInt16LE(offset + 8);
                const compressedSize = buf.readUInt32LE(offset + 18);
                const fileNameLen = buf.readUInt16LE(offset + 26);
                const extraLen = buf.readUInt16LE(offset + 28);
                const fileName = buf.toString('utf8', offset + 30, offset + 30 + fileNameLen);
                const dataStart = offset + 30 + fileNameLen + extraLen;

                if (fileName === 'word/document.xml' && compressedSize > 0 && dataStart + compressedSize <= buf.length) {
                    const compData = buf.subarray(dataStart, dataStart + compressedSize);
                    const xmlBuffer = compression === 8 ? zlib.inflateRawSync(compData) : compData;
                    const xmlStr = xmlBuffer.toString('utf8');
                    const cleanText = xmlStr
                        .replace(/<\/w:p>/gi, '\n')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/&amp;/g, '&')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&quot;/g, '"')
                        .replace(/&#39;/g, "'")
                        .replace(/[ \t]+/g, ' ')
                        .trim();
                    if (cleanText) extractedChunks.push(cleanText);
                    break;
                }
                offset = dataStart + Math.max(1, compressedSize);
            }
            return extractedChunks.join('\n');
        } catch (e) {
            return '';
        }
    }

    function formatProperCase(str) {
        if (!str || typeof str !== 'string') return str;
        const trimmed = str.trim();
        if (!trimmed) return '';
        if (/^(n\/a|none|unknown|null|-)$/i.test(trimmed)) return '';
        if (/^\d/.test(trimmed) && !/[a-zA-Z]{3,}/.test(trimmed)) return trimmed;
        if (/^(CA|NY|TX|FL|NV|AZ|WA|OR|IL|PA|OH|GA|NC|MI|NJ|VA|MA|MD|SSI|SSDI|CAPI|IHSS|NOA|SOC|MC|USCIS|USA|PO|APT|STE|DR|ST|AVE|BLVD|RD|LN|CT|PL|NW|NE|SW|SE|II|III|IV|LLC|INC|MD|DO|RN|NP|PA-C|GED|12\+|B1|B2|B1\/B2|F1|J1|CBP|ICE|EOIR)$/i.test(trimmed)) {
            return trimmed.toUpperCase();
        }
        const upperCount = (trimmed.match(/[A-Z]/g) || []).length;
        const lowerCount = (trimmed.match(/[a-z]/g) || []).length;
        if ((upperCount > 2 && lowerCount === 0) || (lowerCount > 2 && upperCount === 0)) {
            return trimmed.toLowerCase().replace(/\b([a-z])([a-z']*)/g, (match, first, rest) => {
                const wordUp = match.toUpperCase();
                if (/^(CA|SSI|SSDI|CAPI|IHSS|NOA|MD|DO|RN|NP|LLC|INC|PO|II|III|IV|UCLA|USC|DMV|EDD|IRS|EKG|PFT|BNP|CBC|CMP|UTI|GED|EGFR|USA|USSR|USCIS|CBP)$/.test(wordUp)) {
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
                } else if (key === 'aiFeedback') {
                    out[key] = val.trim();
                } else if (['ssn', 'dob', 'phone', 'zip', 'heightFt', 'heightIn', 'weight', 'caseNum', 'aNumber', 'i94Number', 'passportNumber', 'passportExp', 'lastEntryDate', 'statusExpDate', 'marriageDate', 'firstSeen', 'lastSeen', 'nextAppt', 'onsetDate', 'ssiDecisionDate', 'educationDate', 'educationGrade', 'dateFrom', 'dateTo', 'date'].includes(key)) {
                    out[key] = val.trim();
                } else {
                    out[key] = formatProperCase(val);
                }
            } else if (Array.isArray(val)) {
                out[key] = key === 'aiFeedback' ? val : val.map(v => typeof v === 'string' ? formatProperCase(v) : normalizeExtractedObject(v));
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

        const unescaped = String(rawText || '')
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'")
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, ' ')
            .replace(/\\\//g, '/')
            .replace(/&amp;/g, '&');

        const folderRegex1 = /href=["']([^"']*folder_id=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let fMatch;
        while ((fMatch = folderRegex1.exec(unescaped)) !== null) {
            const href = fMatch[1];
            const folderId = fMatch[2];
            const mIdMatch = href.match(/matter_id=(\d+)/i) || href.match(/matters\/(\d+)/i);
            const mId = mIdMatch ? mIdMatch[1] : defaultMatterId;
            const title = fMatch[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

            if (title && title.length > 1 && !/^(delete|edit|rename|download)$/i.test(title) && !folders.some(x => String(x.folderId) === String(folderId))) {
                folders.push({
                    folderId: folderId,
                    matterId: mId,
                    name: title
                });
            }
        }

        const folderRegex2 = /href=["']([^"']*\/folders\/(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
        while ((fMatch = folderRegex2.exec(unescaped)) !== null) {
            const folderId = fMatch[2];
            const title = fMatch[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (title && title.length > 1 && !/^(delete|edit|rename|download)$/i.test(title) && !folders.some(x => String(x.folderId) === String(folderId))) {
                folders.push({
                    folderId: folderId,
                    matterId: defaultMatterId,
                    name: title
                });
            }
        }

        const rowBlocks = unescaped.split(/<tr/i);
        rowBlocks.forEach(tr => {
            if (/folder_id=\d+/i.test(tr) && !/\/documents\/\d+\/download/i.test(tr)) return;

            const idMatch =
                tr.match(/\/(?:documents|files|attachments)\/(\d+)/i) ||
                tr.match(/value=["'](\d+)["']/i) ||
                tr.match(/data-id=["'](\d+)["']/i) ||
                tr.match(/document[_-]id=["']?(\d+)/i);

            if (!idMatch) return;
            const docId = idMatch[1];
            if (folders.some(fld => String(fld.folderId) === String(docId))) return;
            if (files.some(x => String(x.id) === String(docId))) return;

            const dlMatch = tr.match(/href=["']([^"']*(?:download|amazonaws\.com|active_storage|\/documents\/\d+)[^"']*)["']/i);
            const directUrl = dlMatch
                ? (dlMatch[1].startsWith('http') ? dlMatch[1] : `https://app.docketwise.com${dlMatch[1]}`)
                : `https://app.docketwise.com/documents/${docId}`;

            const allCells = [...tr.matchAll(/<(?:td|th|a|span|div)[^>]*>([\s\S]*?)<\/(?:td|th|a|span|div)>/gi)]
                .map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim())
                .filter(Boolean);

            let bestFileName = '';
            const extCell = allCells.find(c => /\.(jpeg|jpg|pdf|png|doc|docx|heic|txt|rtf|webp)$/i.test(c));
            if (extCell) {
                bestFileName = extCell;
            } else {
                const textCell = allCells.find(c =>
                    c.length > 2 &&
                    !/^\d+(\.\d+)?(\s*(mb|kb|bytes))?$/i.test(c) &&
                    !/^\d{2}\/\d{2}\/\d{2,4}$/.test(c) &&
                    !c.includes('@') &&
                    !/^(delete|edit|download|view|actions|name|size|active|--)$/i.test(c)
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
        if (/(zelle|receipt|invoice|payment|retainer|contract|06\.\s*firm|08\.\s*firm|legal services agreement)/i.test(lower)) {
            return { category: 'ignore', badge: '💸 Contract/Fee', priority: 10, autoSelect: false };
        }
        if (/(declaration|statement|affidavit|story|fersion|version|chronological|589)/i.test(lower)) {
            return { category: 'declaration', badge: '📝 Declaration/Story', priority: 105, autoSelect: true };
        }
        if (/(01\.|personal|identification|identity|status|driver|license|dl|passport|birth|marriage|ssn|social|id_card|state_id|green_card|greencard|permanent resident|naturalization|medi-cal|bic|i-94|i94|visa|notice to appear|nta)/i.test(lower)) {
            return { category: 'identity', badge: '🪪 01. Identity/Status/NTA', priority: 100, autoSelect: true };
        }
        if (/(02\.|asylum|persecution|evidence|police|criminal|court|mc_223|mc223|mc 223|soc|873|804|814|453|839|medical|doctor|dr\.|clinic|hospital|meds|medication|rx|diagnosis|visit|summary|noa|ssi|capi|disability|pharmacy|discharge|lab|quest)/i.test(lower)) {
            return { category: 'medical_form', badge: '🩺 02. Case/Evidence/Med', priority: 90, autoSelect: true };
        }
        if (/(03\.|04\.|education|work|job|employment|school|diploma|eoir|ice|filing|history|travel)/i.test(lower)) {
            return { category: 'work_edu', badge: '🏫 03-04. Court/Work/Edu', priority: 85, autoSelect: true };
        }
        return { category: 'other', badge: '📄 Document', priority: 60, autoSelect: false };
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
                }, 7000);

                if (!fRes.ok) continue;

                const arrayBuf = await fRes.arrayBuffer();
                const buf = Buffer.from(arrayBuf);

                const detectedMime = detectRealMimeType(buf);
                if (detectedMime) {
                    if (detectedMime.includes('wordprocessingml')) {
                        const docxText = extractTextFromDocxBuffer(buf);
                        if (docxText) {
                            return { isText: true, textContent: docxText };
                        }
                    } else if (buf.length < 20 * 1024 * 1024) {
                        return {
                            mime_type: detectedMime,
                            data: buf.toString('base64')
                        };
                    }
                }

                const textContent = buf.toString('utf8');
                const s3Regex = /(https:\/\/[^"'\s>]+(?:amazonaws\.com|cloudfront\.net|active_storage)[^"'\s>]*)|(\/rails\/active_storage\/[^"'\s>]+)/i;
                const s3Match = textContent.match(s3Regex);
                if (s3Match) {
                    const rawS3Url = s3Match[0].replace(/&amp;/g, '&').replace(/\\"/g, '');
                    const fullS3Url = rawS3Url.startsWith('http') ? rawS3Url : `https://app.docketwise.com${rawS3Url}`;
                    const s3Res = await fetchWithTimeout(fullS3Url, {
                        headers: rawS3Url.startsWith('http') ? {} : { "cookie": DW_COOKIE }
                    }, 7000);
                    if (s3Res.ok) {
                        const s3Buf = Buffer.from(await s3Res.arrayBuffer());
                        const s3Mime = detectRealMimeType(s3Buf);
                        if (s3Mime) {
                            if (s3Mime.includes('wordprocessingml')) {
                                const docxText = extractTextFromDocxBuffer(s3Buf);
                                if (docxText) return { isText: true, textContent: docxText };
                            } else if (s3Buf.length < 20 * 1024 * 1024) {
                                return {
                                    mime_type: s3Mime,
                                    data: s3Buf.toString('base64')
                                };
                            }
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

            const { clientId, matterId = '', fileIds = [], fileUrls = [], uploadedFiles = [], clientName = '', extraNotes = '' } = req.body || {};
            const inlineParts = [];
            let filesScannedCount = 0;
            let textContext = `Target Client Full Name: ${clientName}\nIMPORTANT: Extract data ONLY for ${clientName}!\n`;
            if (extraNotes) {
                textContext += `\nClient Questionnaire / Additional Notes:\n${extraNotes}\n`;
            }

            if (Array.isArray(uploadedFiles)) {
                uploadedFiles.slice(0, 3).forEach(uf => {
                    if (uf.textContent) {
                        textContext += `\n=== Attached Document (${uf.name || 'Text'}) ===\n${uf.textContent}\n`;
                        filesScannedCount++;
                    } else if (uf.base64) {
                        const rawBuf = Buffer.from(uf.base64, 'base64');
                        const realMime = detectRealMimeType(rawBuf) || uf.mimeType || 'image/jpeg';
                        if (realMime.includes('wordprocessingml')) {
                            const docxText = extractTextFromDocxBuffer(rawBuf);
                            if (docxText) {
                                textContext += `\n=== Attached Word Document (${uf.name || 'Docx'}) ===\n${docxText}\n`;
                                filesScannedCount++;
                            }
                        } else {
                            inlineParts.push({
                                inline_data: {
                                    mime_type: realMime,
                                    data: uf.base64
                                }
                            });
                            filesScannedCount++;
                        }
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
            downloadedParts.forEach((part, idx) => {
                if (!part) return;
                if (part.isText && part.textContent) {
                    textContext += `\n=== Client Declaration / Word Document #${idx + 1} ===\n${part.textContent}\n`;
                    filesScannedCount++;
                } else if (part.data) {
                    inlineParts.push({ inline_data: part });
                    filesScannedCount++;
                }
            });

            const systemPrompt = `You are a senior USCIS Form I-589 (Asylum) & California Medi-Cal/Disability (MC 223) Legal Document & Armenian/Russian/English Translation AI.
Analyze all attached documents and text (Passports, I-94 Records, Visas, Notice to Appear / NTA, Armenian/Russian Birth Certificates, Marriage Certificates, Personal Asylum Declarations/Statements, Police/Medical Records, Questionnaires) for client "${clientName}".

CRITICAL RULES FOR ACCURACY:
1. ARMENIAN / RUSSIAN BIRTH CERTIFICATES & PATRONYMICS (PARENTS - PART A.III LINE 5):
   - In Armenian documents ("Ծննդյան վկայական"), "Հայրը" (Father) is listed FIRST and "Մայրը" (Mother) is listed SECOND. DO NOT swap Father and Mother!
   - Also check the client's patronymic / middle name (for example, "Sevada Taroni Safaryan" means his Father's first name is "Taron" -> "Taron Safaryan"!).
   - Never put a male name in "motherName" or a female name in "fatherName". Transliterate Armenian/Russian names accurately into English.
2. PASSPORT vs I-94 vs A-NUMBER (PART A.I):
   - "aNumber": 9-digit Alien Registration Number (often starts with A or 2, found on Notice to Appear / NTA, I-94, or EAD).
   - "i94Number": 11-character Arrival/Departure Record number from Form I-94. NEVER put a Passport number or Visa number into "i94Number"!
   - "immigrationCourtStatus": If there is a "Notice to Appear" (NTA) or EOIR filing, set to "now" (I am now in Immigration Court proceedings). Otherwise "never".
3. ASYLUM DECLARATION / PERSONAL STATEMENT (PART B & PART C):
   - Carefully read any attached Declaration / Affidavit / Statement / Police / Medical evidence.
   - Determine all applicable "grounds": ["Political Opinion", "Religion", "Race", "Nationality", "Particular Social Group", "Torture Convention"].
   - If the client experienced past harm, threats, beatings, detention, or persecution, set "experiencedHarm": "Yes" and write a clear, factual 3-4 sentence summary (250-360 characters) in "harmSummary" answering: What happened, When, Who caused it, and Why, ending with "See attached Declaration."
   - If the client fears harm upon return, set "fearReturn": "Yes" and write a 3-4 sentence summary (250-360 characters) in "fearSummary".
   - If the client was detained/arrested/interrogated or had a criminal case fabricated against them abroad, set "arrestedAbroad": "Yes" and summarize in "arrestSummary".
   - If the client belonged to a party/church/organization/group, set "orgMember": "Yes" and summarize in "orgSummary".
   - If the client fears torture by authorities, set "fearTorture": "Yes" and summarize in "tortureSummary".
   - For Part C: Unless the documents explicitly state otherwise, "priorAsylumApp" is "No", "causedHarm" is "No", and "usCrimes" is "No". If the client traveled through transit countries before entering the US, set "traveledOtherCountries": "Yes" and list them in "otherCountriesSummary".
4. AI FEEDBACK ("aiFeedback") — STRICTLY IN RUSSIAN, CLEAR & CHRONOLOGICAL:
   - Provide specific notes in Russian about any unclear or missing details found in the scanned documents.

Return ONLY valid JSON matching this exact structure (use empty string "" if not mentioned in the current batch of files):
{
  "firstName": "",
  "lastName": "",
  "middleName": "",
  "otherNames": "",
  "ssn": "",
  "aNumber": "",
  "uscisAccount": "",
  "dob": "MM/DD/YYYY",
  "gender": "Male or Female",
  "maritalStatus": "Single, Married, Divorced, or Widowed",
  "cityCountryBirth": "",
  "nationality": "",
  "nationalityAtBirth": "",
  "raceEthnicTribal": "",
  "religion": "",
  "nativeLanguage": "Armenian",
  "fluentEnglish": "Yes or No",
  "otherLanguages": "",
  "heightFt": "",
  "heightIn": "",
  "weight": "",
  "street": "",
  "apt": "",
  "city": "",
  "state": "CA",
  "zip": "",
  "phone": "",
  "language": "Armenian",
  "caseNum": "",
  "immigrationCourtStatus": "",
  "leftHomeCountryDate": "MM/DD/YYYY",
  "lastEntryDate": "MM/DD/YYYY",
  "lastEntryPlace": "",
  "lastEntryStatus": "",
  "i94Number": "",
  "statusExpDate": "MM/DD/YYYY",
  "passportCountry": "",
  "passportNumber": "",
  "passportExp": "MM/DD/YYYY",
  "spouse": {
    "aNumber": "",
    "passportNumber": "",
    "dob": "MM/DD/YYYY",
    "ssn": "",
    "lastName": "",
    "firstName": "",
    "middleName": "",
    "maidenName": "",
    "marriageDate": "MM/DD/YYYY",
    "marriagePlace": "",
    "cityCountryBirth": "",
    "nationality": "",
    "race": "",
    "gender": "Male or Female",
    "inUS": "Yes or No",
    "locationIfNotUS": "",
    "placeLastEntry": "",
    "dateLastEntry": "MM/DD/YYYY",
    "i94Number": "",
    "lastEntryStatus": "",
    "currentStatus": "",
    "statusExpDate": "MM/DD/YYYY",
    "inCourt": "Yes or No",
    "includeInApp": "Yes or No"
  },
  "children": [
    {
      "aNumber": "",
      "passportNumber": "",
      "maritalStatus": "Single",
      "ssn": "",
      "lastName": "",
      "firstName": "",
      "middleName": "",
      "dob": "MM/DD/YYYY",
      "cityCountryBirth": "",
      "nationality": "",
      "race": "",
      "gender": "Male or Female",
      "inUS": "Yes or No",
      "locationIfNotUS": "",
      "placeLastEntry": "",
      "dateLastEntry": "MM/DD/YYYY",
      "i94Number": "",
      "lastEntryStatus": "",
      "currentStatus": "",
      "statusExpDate": "MM/DD/YYYY",
      "inCourt": "Yes or No",
      "includeInApp": "Yes or No"
    }
  ],
  "lastAddressBeforeUS": {
    "street": "",
    "city": "",
    "departmentState": "",
    "country": "",
    "dateFrom": "MM/YYYY",
    "dateTo": "MM/YYYY"
  },
  "residences5Years": [
    { "street": "", "city": "", "state": "", "country": "", "dateFrom": "MM/YYYY", "dateTo": "MM/YYYY" }
  ],
  "educationHistory": [
    { "schoolName": "", "schoolType": "", "location": "", "dateFrom": "MM/YYYY", "dateTo": "MM/YYYY" }
  ],
  "employment5Years": [
    { "employerAndAddress": "", "occupation": "", "dateFrom": "MM/YYYY", "dateTo": "MM/YYYY" }
  ],
  "family": {
    "motherName": "",
    "motherBirthPlace": "",
    "motherDeceased": "",
    "motherLocation": "",
    "fatherName": "",
    "fatherBirthPlace": "",
    "fatherDeceased": "",
    "fatherLocation": "",
    "siblings": [
      { "name": "", "birthPlace": "", "deceased": "", "location": "" }
    ]
  },
  "asylum": {
    "grounds": [],
    "experiencedHarm": "",
    "harmSummary": "",
    "fearReturn": "",
    "fearSummary": "",
    "arrestedAbroad": "",
    "arrestSummary": "",
    "orgMember": "",
    "orgSummary": "",
    "continueOrg": "",
    "continueOrgSummary": "",
    "fearTorture": "",
    "tortureSummary": "",
    "priorAsylumApp": "",
    "priorAsylumSummary": "",
    "traveledOtherCountries": "",
    "lawfulStatusOtherCountry": "",
    "otherCountriesSummary": "",
    "causedHarm": "",
    "returnedToHomeCountry": "",
    "returnedSummary": "",
    "filedAfterOneYear": "",
    "oneYearReason": "",
    "usCrimes": ""
  },
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
  },
  "aiFeedback": []
}`;

            const requestParts = [{ text: systemPrompt + "\n\n" + textContext }, ...inlineParts];

// Приоритет: Флагманские модели Pro и Thinking (глубокий анализ армянских/русских документов и деклараций I-589)
            const modelsPool = [
                'gemini-2.5-pro',
                'gemini-pro-latest',
                'gemini-2.5-flash',
                'gemini-2.0-flash'
            ];

            let aiJson = null;
            let usedModel = '';
            let lastErr = '';

            for (const modelName of modelsPool) {
                try {
                    const genConfig = {
                        temperature: 0.1
                    };

                    // Включаем режим глубокого мышления (Thinking) для сложных задач и переводов!
                    if (modelName.includes('2.5')) {
                        genConfig.thinkingConfig = {
                            thinkingBudget: 4096
                        };
                    }

                    // Даем флагманской Pro/Thinking модели до 28 секунд на глубокий анализ документов
                    const gRes = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: requestParts }],
                            generationConfig: genConfig
                        })
                    }, 28000);

                    if (gRes.ok) {
                        const gData = await gRes.json();
                        const partsArr = gData.candidates?.[0]?.content?.parts || [];
                        // Ищем финальный JSON-ответ после блока размышлений (thinking)
                        const textPart = partsArr.find(p => p.text && p.text.includes('{') && p.text.includes('"firstName"')) || partsArr[partsArr.length - 1] || {};
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
                filesScanned: filesScannedCount || inlineParts.length
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
            const reqHeaders = {
                "accept": "*/*;q=0.5, text/javascript, application/javascript, application/ecmascript, application/x-ecmascript",
                "accept-language": "en-US,en;q=0.5",
                "x-csrf-token": DW_CSRF_TOKEN,
                "x-requested-with": "XMLHttpRequest",
                "cookie": DW_COOKIE,
                "Referer": `https://app.docketwise.com/en/matters/${matterId || ''}`
            };

            let targetUrl = `https://app.docketwise.com/documents?matter_id=${matterId || ''}`;
            if (folderId && folderId !== 'ALL_KEY_FOLDERS') {
                targetUrl = `https://app.docketwise.com/documents?folder_id=${folderId}&matter_id=${matterId || ''}`;
            }

            const docRes = await fetch(targetUrl, { headers: reqHeaders });
            const rawText = await docRes.text();
            const parsed = parseDocketwiseDocumentsResponse(rawText, matterId);

            let allFoldersList = [...parsed.folders];
            let allFiles = parsed.files.map(f => ({
                ...f,
                folderName: 'Root',
                ...classifyClientFile(f.name, '')
            }));

            // Если открыта конкретная папка (например, 02. EVIDENCE OF PERSECUTION), а внутри неё есть подпапки (Affidavit, Photo) — заходим и в них!
            if (folderId && folderId !== 'ALL_KEY_FOLDERS' && parsed.folders.length > 0) {
                const subArr = await Promise.all(parsed.folders.slice(0, 8).map(async (sf) => {
                    try {
                        const sfRes = await fetch(`https://app.docketwise.com/documents?folder_id=${sf.folderId}&matter_id=${matterId}`, { headers: reqHeaders });
                        const sfParsed = parseDocketwiseDocumentsResponse(await sfRes.text(), matterId);
                        return sfParsed.files.map(f => ({
                            ...f,
                            folderId: sf.folderId,
                            folderName: `↳ ${sf.name}`,
                            ...classifyClientFile(f.name, sf.name)
                        }));
                    } catch (e) { return []; }
                }));
                subArr.forEach(sa => {
                    sa.forEach(fileItem => {
                        if (!allFiles.some(existing => String(existing.id) === String(fileItem.id))) {
                            allFiles.push(fileItem);
                        }
                    });
                });
            }

            // Если выбрано ALL_KEY_FOLDERS — обходим ВСЕ папки дела И ВСЕ вложенные подпапки (Affidavit, Photo и т.д.)!
            if ((!folderId || folderId === 'ALL_KEY_FOLDERS') && parsed.folders.length > 0) {
                const foldersToScan = parsed.folders.filter(fld => !/(06\.|08\.|contract|fee|invoice)/i.test(fld.name)).slice(0, 8);

                const subResults = await Promise.all(foldersToScan.map(async (fld) => {
                    try {
                        const subUrl = `https://app.docketwise.com/documents?folder_id=${fld.folderId}&matter_id=${matterId}`;
                        const subRes = await fetch(subUrl, { headers: reqHeaders });
                        const subText = await subRes.text();
                        const subParsed = parseDocketwiseDocumentsResponse(subText, matterId);

                        let collected = subParsed.files.map(f => ({
                            ...f,
                            folderId: fld.folderId,
                            folderName: fld.name,
                            ...classifyClientFile(f.name, fld.name)
                        }));

                        if (subParsed.folders.length > 0) {
                            subParsed.folders.forEach(nf => {
                                if (!allFoldersList.some(x => String(x.folderId) === String(nf.folderId))) {
                                    allFoldersList.push({
                                        folderId: nf.folderId,
                                        matterId: matterId,
                                        name: `${fld.name.slice(0, 18)} ➔ ${nf.name}`
                                    });
                                }
                            });

                            const nestedArr = await Promise.all(subParsed.folders.slice(0, 6).map(async (nf) => {
                                try {
                                    const nfRes = await fetch(`https://app.docketwise.com/documents?folder_id=${nf.folderId}&matter_id=${matterId}`, { headers: reqHeaders });
                                    const nfParsed = parseDocketwiseDocumentsResponse(await nfRes.text(), matterId);
                                    return nfParsed.files.map(f => ({
                                        ...f,
                                        folderId: nf.folderId,
                                        folderName: `${fld.name} / ${nf.name}`,
                                        ...classifyClientFile(f.name, `${fld.name} ${nf.name}`)
                                    }));
                                } catch (e) { return []; }
                            }));
                            nestedArr.forEach(na => { collected = collected.concat(na); });
                        }
                        return collected;
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
                if (f.autoSelect && checkedCount < 6) {
                    checkedCount++;
                    return { ...f, autoSelect: true };
                }
                return { ...f, autoSelect: false };
            });

            return res.status(200).json({
                success: true,
                folders: allFoldersList,
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
                } else if (/(petros|norayr|artak|argishti|armen|aram|karen|vahan|vahe|davtyan|david|tigran|gevorg|hayk|samvel|gagik|ashot|vigen|levon|ruben|artur|arthur|hovhannes|sargis|sevak|grigor|hakob|harutyun|yurik|sevada)$/i.test(fn)) {
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
                    apt,
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
