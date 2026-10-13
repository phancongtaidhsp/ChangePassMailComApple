# Request Recovery Email OTP Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Call `GetOneTimeCode.srf` with the configured recovery email when Microsoft reports an eligible email proof.

**Architecture:** Extend the existing inline login orchestration in `UnlockInternalAsync`. Reuse `_makeRequest` so proxy, cookies, retry behavior, and request conventions remain consistent with the rest of `hotmail.js`.

**Tech Stack:** Node.js, Axios through the existing `_makeRequest` wrapper, `URLSearchParams`.

---

## Chunk 1: Recovery email OTP request

### Task 1: Add the inline request

**Files:**
- Modify: `hotmail.js:221-238`

- [ ] **Step 1: Capture the eligible email proof**

Replace the boolean-only detection with a variable that retains the matching proof object while preserving the existing phone-proof rejection.

- [ ] **Step 2: Validate dynamic request inputs**

When an email proof exists, require `this.recoveryEmail` and the proof's encrypted `data` value before issuing the request.

- [ ] **Step 3: Call `GetOneTimeCode.srf`**

Use `_makeRequest` with the captured cURL's stable headers and form fields. Populate `login`, `flowtoken`, `uaid`, `AltEmailE`, and `ProofConfirmation` from the current object/session.

- [ ] **Step 4: Handle request failure**

Return the existing error-result shape for a null response, non-2xx status, or explicit API error; otherwise continue to the password request.

- [ ] **Step 5: Verify syntax and diff**

Run: `node --check hotmail.js`

Expected: exit code 0 with no output.

Run: `git diff --check && git diff -- hotmail.js`

Expected: no whitespace errors and a focused change before the password request.
