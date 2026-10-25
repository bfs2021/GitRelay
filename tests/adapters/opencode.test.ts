import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import plugin from "../../src/adapters/opencode/index.ts";
import { fixture } from "../helpers.ts";

test("OpenCode plugin waits for idle and prompts the enrolled session", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.b, "shared.txt"), "local\n");
  t.mock.timers.enable({ apis: ["setInterval"] });
  const delivered = Promise.withResolvers<any>();
  let count = 0;
  const adapter = await plugin({
    directory: f.b,
    client: {
      session: { async prompt(input) { count++; delivered.resolve(input); } },
      app: { async log(input) { delivered.reject(new Error(input.body.message)); } },
    },
  });
  t.after(async () => { await adapter.event({ event: { type: "server.instance.disposed" } }); });
  await adapter["chat.message"]({ sessionID: "session-B" });
  await f.commit(f.main, "shared.txt", "upstream\n");
  t.mock.timers.tick(5000);
  assert.equal(count, 0);
  await adapter.event({ event: { type: "session.idle", properties: { sessionID: "session-B" } } });
  t.mock.timers.tick(5000);
  const timeout = setTimeout(() => delivered.reject(new Error("OpenCode delivery timed out")), 3000);
  t.after(() => clearTimeout(timeout));
  const input = await delivered.promise;
  assert.deepEqual(input.path, { id: "session-B" });
  assert.match(input.body.parts[0].text, /shared.txt/);
  assert.equal(input.body.noReply, undefined);
  await adapter.event({ event: { type: "session.deleted", properties: { info: { id: "session-B" } } } });
});
