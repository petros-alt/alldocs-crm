export default async function handler(req, res) {
    // ВАЖНО: Удалите текст "ВСТАВЬТЕ_ВАШ_КЛЮЧ_СЮДА" и вставьте между кавычками ваш настоящий длинный ключ от Docketwise.
    // Вы можете подсмотреть его в вашем рабочем файле api/search.js
    const API_KEY = "a-YHg4J2SN1SX7TC17_iLQHTB43qSTXaTUZLNqtAeAE"; 
    
    const clientId = "24262633"; 

    try {
        const response = await fetch(`https://app.docketwise.com/api/v1/contacts/${clientId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Accept': 'application/json'
            }
        });

        // Читаем сырой ответ от сервера, даже если это ошибка
        const rawText = await response.text(); 
        
        try {
            // Пытаемся превратить в список
            const data = JSON.parse(rawText); 
            res.status(200).json({ http_status: response.status, data: data });
        } catch (parseError) {
            // Если это не список, выводим сырой текст
            res.status(200).json({ 
                http_status: response.status, 
                message: "Docketwise вернул не JSON. Вот сырой ответ:", 
                raw_response: rawText 
            });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}