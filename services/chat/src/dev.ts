import { buildChatDevServer } from "./dev-server.ts";

const host = process.env.CHAT_HOST ?? "127.0.0.1";
const port = Number(process.env.CHAT_PORT ?? "4310");

const { server, close, describe } = await buildChatDevServer(process.env);

server.listen(port, host, () => {
  console.log(`chat listening on http://${host}:${port} (${describe()})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      close().finally(() => process.exit(0));
    });
  });
}
