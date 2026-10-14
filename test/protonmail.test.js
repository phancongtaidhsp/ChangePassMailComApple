const assert = require("assert").strict;
const axios = require("axios");
const ProtonMail = require("../src/services/protonmail");

async function run() {
  const originalAdapter = axios.defaults.adapter;
  let calls = [];
  let replies = [];
  axios.defaults.adapter = async config => {
    calls.push(config);
    const reply = replies.shift();
    assert(reply, "Unexpected request");
    if (reply instanceof Error) throw reply;
    return { headers: {}, config, ...reply };
  };
  const session = { status: 200, data: { Code: 1000, UID: "test-uid", AccessToken: "test-token" } };
  const email = "example@proton.me";
  try {
    const checker = new ProtonMail(null, email, { retryDelayMs: 0 });
    replies = [session, { status: 200, data: { Code: 1000 } }];
    const available = await checker.CheckEmail(" Example@Proton.Me ");
    assert.equal(available.exists, false);
    assert.equal(available.available, true);
    assert.equal(calls[0].method, "post");
    assert(calls[0].url.endsWith("auth/v4/sessions"));
    assert.deepEqual(calls[1].params, { Name: email, ParseDomain: 1 });
    assert.equal(calls[1].headers.Authorization, "Bearer test-token");

    calls = [];
    replies = [{ status: 422, data: { Code: 12106 } }];
    const unavailable = await checker.CheckEmail();
    assert.equal(calls.length, 1, "Reuse guest session");
    assert.equal(unavailable.available, false);
    assert.equal(unavailable.exists, null, "Unavailable is not proof of existence");

    for (const response of [
      { status: 429, data: { Code: 429 }, headers: { "retry-after": "60" } },
      { status: 403, data: { Code: 9001 } },
      { status: 503, data: { Code: 12106 } },
      { status: 200, data: "<html>challenge</html>" },
      { status: 422, data: { Code: 2001 } },
    ]) {
      calls = [];
      replies = [response];
      const result = await checker.CheckEmail();
      assert.equal(result.status, "error");
      assert.equal(result.exists, null);
      assert.equal(result.available, null);
      if (response.status === 429) {
        assert.equal(result.retryAfter, "60");
        assert.equal(result.retryable, true);
      }
      if (response.data?.Code === 9001) {
        assert.equal(result.verificationRequired, true);
        assert.equal(result.retryable, false);
      }
      assert.equal(replies.length, 0);
      assert.equal(calls.length, 1, "HTTP errors are not retried");
    }

    calls = [];
    for (const invalid of [null, "", "example@gmail.com", "a+b@proton.me", "a@@pm.me", "a b@pm.me"]) {
      assert.equal((await checker.CheckEmail(invalid)).status, "error");
    }
    assert.equal(calls.length, 0);

    replies = [{ status: 401, data: { Code: 401 } }];
    assert.equal((await checker.CheckEmail()).exists, null);
    assert.equal(checker.accessToken, null);
    replies = [{ status: 200, data: { Code: 1000 } }];
    assert.equal((await checker.CheckEmail()).status, "error", "Reject session without tokens");

    const networkError = code => Object.assign(new Error("network failure"), { code });
    calls = [];
    replies = [networkError("ENOTFOUND"), session, networkError("ECONNRESET"),
      networkError("ECONNABORTED"), { status: 200, data: { Code: 1000 } }];
    const recovered = await checker.CheckEmail();
    assert.equal(recovered.status, "success");
    assert.equal(recovered.retries, 3);
    assert.equal(calls.length, 5, "Retry budget shared between guest session and availability check");
    assert.equal(calls.filter(call => call.url.endsWith("auth/v4/sessions")).length, 2);
    assert.equal(replies.length, 0);

    calls = [];
    replies = Array.from({ length: 4 }, () => networkError("ECONNABORTED"));
    const exhausted = await checker.CheckEmail();
    assert.equal(exhausted.status, "error");
    assert.equal(exhausted.networkError, true);
    assert.equal(exhausted.retries, 3);
    assert.equal(calls.length, 4, "At most one initial attempt plus three retries");
    assert.equal(replies.length, 0);

    // Hủy trong thời gian nghỉ phải dừng ngay, không phát sinh request tiếp theo.
    const controller = new AbortController();
    checker.abortSignal = controller.signal;
    checker.retryDelayMs = 10000;
    calls = [];
    replies = [networkError("ETIMEDOUT")];
    const pending = checker.CheckEmail();
    setImmediate(() => controller.abort());
    const interrupted = await pending;
    assert.equal(interrupted.networkError, false);
    assert.equal(interrupted.retryable, false);
    assert.equal(calls.length, 1);

    checker.abortSignal = { aborted: true };
    calls = [];
    const canceled = await checker.CheckEmail();
    assert.equal(canceled.retryable, false);
    assert.equal(canceled.exists, null);
    assert.equal(calls.length, 0);
    console.log("ProtonMail tests passed");
  } finally {
    axios.defaults.adapter = originalAdapter;
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
