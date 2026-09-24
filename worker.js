// Gemini Relay Worker
// Этот код создаёт WebSocket-сервер, который принимает зашифрованные
// запросы от нашего приложения и перенаправляет их к Gemini через
// TCP-соединение от имени Cloudflare.

import { connect } from 'cloudflare:sockets';

export default {
  async fetch(request, env, ctx) {
    // 1. Проверяем, что запрос — это WebSocket upgrade
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

  // 2. Проверяем секретный ключ (должен совпадать с ключом в приложении)
const authKey = request.headers.get('X-Auth-Key');
if (authKey !== env.SECRET_KEY) {
  return new Response(
    `Unauthorized. Got: "${authKey}", Expected: "${env.SECRET_KEY}"`,
    { status: 401 }
  );
}

    // 3. Устанавливаем WebSocket-соединение
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();

    // 4. Обрабатываем сообщения от нашего приложения
    server.addEventListener('message', async (event) => {
      try {
        // Формат сообщения: { host: "gemini.google.com", port: 443, data: "base64..." }
        const msg = JSON.parse(event.data);
        const { host, port, data } = msg;

        // 5. Открываем TCP-соединение к реальному серверу
        const tcpSocket = connect({ hostname: host, port: port });
        const writer = tcpSocket.writable.getWriter();

        // 6. Расшифровываем данные и отправляем в TCP
        const rawData = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        await writer.write(rawData);

        // 7. Читаем ответ от TCP и отправляем обратно в WebSocket
        const reader = tcpSocket.readable.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const encoded = btoa(String.fromCharCode(...value));
          server.send(JSON.stringify({ data: encoded }));
        }

        writer.releaseLock();
        await tcpSocket.close();
      } catch (err) {
        server.send(JSON.stringify({ error: err.message }));
      }
    });

    // 8. Возвращаем WebSocket-ответ
    return new Response(null, { status: 101, webSocket: client });
  },
};