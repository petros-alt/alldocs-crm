export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    }

    const { first_name, last_name, phone } = req.body;

    // 🔑 ИСПОЛЬЗУЕМ ТОЛЬКО ПРЯМОЙ API КЛЮЧ
    const API_KEY = "a-YHg4J2SN1SX7TC17_iLQHTB43qSTXaTUZLNqtAeAE";

    try {
        // Передаем ключ как api_key в ссылке - самый надежный способ для Docketwise
        const apiUrl = `https://app.docketwise.com/api/v1/contacts?api_key=${API_KEY}`;

        const dwResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                first_name: first_name || "Test",
                last_name: last_name || "Lead",
                // Передаем телефон, если он есть
                phone_numbers_attributes: phone ? [{ number: phone }] : []
            })
        });

        // Безопасно читаем ответ сервера
        const textResponse = await dwResponse.text();
        let data = {};

        if (textResponse) {
            try {
                data = JSON.parse(textResponse);
            } catch (e) {
                data = { raw_text: textResponse }; 
            }
        }

        if (dwResponse.ok) {
            return res.status(200).json({ success: true, contact: data });
        } else {
            return res.status(400).json({ 
                success: false, 
                error: "Docketwise rejected the request", 
                docketwise_status: dwResponse.status,
                docketwise_details: data 
            });
        }

    } catch (error) {
        console.error("Docketwise Creation Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
