const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseSessionWindowRequest,
  sessionWindowKey,
  sessionWindowQuery,
} = require("./session-window.cjs");

test("accepts a session and host id and routes the window to them", () => {
  const request = parseSessionWindowRequest({ sessionId: "agt_1-a.b", hostId: "h:2" });
  assert.deepEqual(request, { sessionId: "agt_1-a.b", hostId: "h:2" });
  assert.deepEqual(sessionWindowQuery(request), { popout: "agt_1-a.b", host: "h:2" });
  assert.equal(sessionWindowKey(request), "h:2/agt_1-a.b");
});

test("the host is optional", () => {
  const request = parseSessionWindowRequest({ sessionId: "a" });
  assert.deepEqual(sessionWindowQuery(request), { popout: "a" });
});

test("refuses anything that is not a plain id", () => {
  for (const input of [
    null,
    "a",
    {},
    { sessionId: "" },
    { sessionId: "a/b" },
    { sessionId: "a&popout=x" },
    { sessionId: "a", hostId: 4 },
    { sessionId: "a", hostId: "x y" },
    { sessionId: "x".repeat(201) },
  ])
    assert.equal(parseSessionWindowRequest(input), null, JSON.stringify(input));
});
