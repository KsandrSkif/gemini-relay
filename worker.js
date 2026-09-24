import { connect } from 'cloudflare:sockets';

export default {
  async fetch(request, env, ctx) {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const authKey = request.headers.get('X-Auth-Key');
    if (authKey !== env.SECRET_KEY) {
      return new Response('Unauthorized', { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    let tcpWriter = null;
    let tcpReader = null;
    let connected = false;

    async function pumpFromTcp() {
      try {
        while (true) {
          const { done, value } = await tcpReader.read();
          if (done) break;
          const b64 = btoa(String.fromCharCode(...value));
          server.send(JSON.stringify({ data: b64 }));
        }
      } catch (e) {}
      try { server.send(JSON.stringify({ closed: true })); } catch (e) {}
      try { server.close(); } catch (e) {}
    }

    server.addEventListener('message', async (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (!connected && msg.host) {
          const tcp = connect({ hostname: msg.host, port: msg.port || 443 });
          tcpWriter = tcp.writable.getWriter();
          tcpReader = tcp.readable.getReader();
          connected = true;
          server.send(JSON.stringify({ connected: true }));
          pumpFromTcp();
          return;
        }

        if (connected && msg.data) {
          const raw = Uint8Array.from(atob(msg.data), c => c.charCodeAt(0));
          await tcpWriter.write(raw);
        }
      } catch (e) {
        try { server.send(JSON.stringify({ error: String(e) })); } catch (_) {}
      }
    });

    server.addEventListener('close', async () => {
      try { await tcpWriter?.close(); } catch (e) {}
    });

    return new Response(null, { status: 101, webSocket: client });
  },
};