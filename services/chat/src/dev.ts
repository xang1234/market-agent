import { createChatServer } from "./http.ts";

const host = process.env.CHAT_HOST ?? "127.0.0.1";
const port = Number(process.env.CHAT_PORT ?? "4310");
const server = createChatServer();

server.listen(port, host, () => {
  console.log(`chat listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
