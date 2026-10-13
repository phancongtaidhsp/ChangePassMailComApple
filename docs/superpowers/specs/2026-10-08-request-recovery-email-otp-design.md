# Request Recovery Email OTP Design

## Goal

When `GetCredentialType` reports an eligible email proof, call Microsoft's `GetOneTimeCode.srf` endpoint with the configured recovery email before continuing the existing password-login flow.

## Design

- Keep the implementation inline in `UnlockInternalAsync`, immediately after inspecting `OtcLoginEligibleProofs` and before the existing password request.
- Retain the first eligible email proof so its encrypted `data` value can be sent as `AltEmailE`.
- Use current session values (`flowtoken`, `uaid`, cookies maintained by `_makeRequest`) instead of copying session-specific values from the captured cURL.
- Send `this.recoveryEmail` as `ProofConfirmation`.
- Stop with a descriptive error when the recovery email, proof data, or OTP request is unavailable or rejected.
- On a successful OTP request, continue into the existing password-login request without implementing OTP retrieval or submission.

## Error Handling

The method returns its existing `{ status: "error", message }` shape for missing inputs, a failed HTTP request, a non-2xx response, or an API response containing an error.

## Verification

Per the user's request, no automated test will be added. Validate JavaScript syntax with `node --check hotmail.js` and inspect the focused diff.
