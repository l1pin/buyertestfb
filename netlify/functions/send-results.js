const https = require('https');

exports.handler = async (event, context) => {
  // Проверяем метод
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Получаем данные
    const formData = JSON.parse(event.body);
    
    // Токен бота из переменных окружения (БЕЗОПАСНО!)
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!BOT_TOKEN) {
      throw new Error('Telegram bot token not configured');
    }

    // Получаем список всех чатов
    const chatIds = await getAllChats(BOT_TOKEN);
    
    if (chatIds.length === 0) {
      throw new Error('No subscribers found');
    }

    // Форматируем сообщение
    const message = formatMessage(formData);
    
    // Разбиваем на части
    const messageParts = splitMessage(message);
    
    // Отправляем всем
    let successCount = 0;
    
    for (const chatId of chatIds) {
      try {
        for (let i = 0; i < messageParts.length; i++) {
          if (i > 0) await sleep(1000);
          await sendMessage(BOT_TOKEN, chatId, messageParts[i]);
        }
        successCount++;
      } catch (error) {
        console.error(`Error sending to ${chatId}:`, error.message);
      }
      
      await sleep(100); // Защита от лимитов
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: true, 
        sent_to: successCount, 
        total_chats: chatIds.length 
      })
    };

  } catch (error) {
    console.error('Function error:', error);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};

// Получить все чаты
async function getAllChats(botToken) {
  const updates = await makeRequest('GET', `https://api.telegram.org/bot${botToken}/getUpdates?limit=100`);
  
  if (!updates.ok || !updates.result) {
    return [];
  }

  const chatIds = new Set();
  
  updates.result.forEach(update => {
    if (update.message && update.message.from && !update.message.from.is_bot) {
      chatIds.add(update.message.chat.id);
    }
  });

  return Array.from(chatIds);
}

// Отправить сообщение
async function sendMessage(botToken, chatId, message) {
  const payload = {
    chat_id: chatId,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };

  const result = await makeRequest('POST', `https://api.telegram.org/bot${botToken}/sendMessage`, payload);
  
  if (!result.ok) {
    throw new Error(`Telegram API error: ${result.description}`);
  }
  
  return result;
}

// HTTP запрос
function makeRequest(method, url, data = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve(parsed);
        } catch (error) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data && method === 'POST') {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

// Форматирование сообщения
function formatMessage(formData) {
  let message = `<b>📋 НОВЫЙ КАНДИДАТ - FB ADS TEST</b>\n\n`;
  
  message += `<b>👤 Кандидат:</b> <code>${formData.fio}</code>\n`;
  message += `<b>📱 Telegram:</b> ${formData.telegram}\n`;
  message += `<b>🕐 Дата прохождения:</b> ${formData.submitted_at_local}\n\n`;

  message += `<b>⏱ Статистика времени:</b>\n`;
  message += `• Общее время просмотра: ${formData.summary.total_view_time_formatted}\n`;
  message += `• Общее время набора: ${formData.summary.total_typing_time_formatted}\n`;
  message += `• Количество товаров: ${formData.summary.items_count}\n\n`;

  message += `<b>📝 ОТВЕТЫ ПО ТОВАРАМ:</b>\n${'═'.repeat(30)}\n`;

  for (const [code, item] of Object.entries(formData.items)) {
    message += `\n<b>${item.code} - ${item.name}</b>\n`;
    message += `⏱ Время: просмотр ${item.time_view_formatted} | набор ${item.time_typing_formatted}\n`;
    
    message += `\n<b>📢 РЕКЛАМНЫЙ ТЕКСТ:</b>\n<code>${item.ads_copy}</code>\n`;
    message += `\n<b>🔍 АНАЛИЗ И РЕКОМЕНДАЦИИ:</b>\n<code>${item.analysis}</code>\n`;
    message += `\n<b>🔗 Материалы:</b>\n• <a href="${item.landing}">Лендинг</a> | <a href="${item.video}">Видео</a>\n`;
    message += `\n${'─'.repeat(25)}\n`;
  }

  message += `\n<b>💻 Технические данные:</b>\n`;
  message += `• Страница: ${formData.page_url}\n`;
  message += `• Устройство: ${formData.user_agent.includes('Mobile') ? '📱 Mobile' : '💻 Desktop'}\n`;
  message += `• Версия системы: ${formData.version}\n`;

  return message;
}

// Разбить сообщение на части
function splitMessage(message, maxLength = 4000) {
  if (message.length <= maxLength) {
    return [message];
  }

  const parts = [];
  const headerEnd = message.indexOf('📝 ОТВЕТЫ ПО ТОВАРАМ:');
  const header = message.substring(0, headerEnd);
  const itemsSection = message.substring(headerEnd);
  const items = itemsSection.split('─'.repeat(25));
  
  parts.push(header + '📝 ОТВЕТЫ ПО ТОВАРАМ:\n' + '═'.repeat(30));
  
  let currentPart = '';
  for (let i = 0; i < items.length; i++) {
    if (currentPart.length + items[i].length > maxLength) {
      if (currentPart) parts.push(currentPart);
      currentPart = items[i];
    } else {
      currentPart += items[i];
    }
    if (i < items.length - 1) currentPart += '─'.repeat(25);
  }
  
  if (currentPart) parts.push(currentPart);
  return parts;
}

// Задержка
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
