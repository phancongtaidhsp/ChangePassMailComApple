const assert = require('node:assert/strict');
const { extractAppleVerificationLinks } = require('../src/services/apple-verification-link');

const link = 'https://iforgot.apple.com/verify/email?key=test%2Bkey';
assert.deepEqual(extractAppleVerificationLinks(`<a href="${link}">Verify</a>`), [link]);
assert.deepEqual(extractAppleVerificationLinks(`<a href='${link}&amp;lang=en'>Verify</a>`), [`${link}&lang=en`]);
assert.deepEqual(extractAppleVerificationLinks(`Verify: ${link}\nThank you`), [link]);
assert.deepEqual(extractAppleVerificationLinks(`<a href="${link}">${link}</a>`), [link]);
assert.deepEqual(extractAppleVerificationLinks(`<a href="https://deref-gmx.com/r/?to=${encodeURIComponent(link)}&amp;tt1=test">Verify</a>`), [link]);
// Dạng mail.com chỉ encode dấu phân cách query trong URL đích.
assert.deepEqual(extractAppleVerificationLinks('<a href="https://deref-gmx.com/r/?to=https://iforgot.apple.com/verify/email%3Fkey%3Dfixture-key%26language%3DUS-EN&tt1=fixture">Verify</a>'),
  ['https://iforgot.apple.com/verify/email?key=fixture-key&language=US-EN']);
assert.deepEqual(extractAppleVerificationLinks(`<a href="https://deref-gmx.com/r/#${link}">Verify</a>`), [link]);
assert.deepEqual(extractAppleVerificationLinks(`<a href="https://deref-gmx.com/r/#${encodeURIComponent(link)}">Verify</a>`), [link]);
assert.deepEqual(extractAppleVerificationLinks(`<a href="${link}">Verify</a><a href="${link}2">Again</a>`), [link, `${link}2`]);
for (const body of [null, {}, '', 'No link',
  '<a href="https://iforgot.apple.com.evil.example/verify/email?key=test">Verify</a>',
  '<a href="https://iforgot.apple.com@evil.example/verify/email?key=test">Verify</a>',
  '<a href="http://iforgot.apple.com/verify/email?key=test">Verify</a>',
  '<a href="https://iforgot.apple.com/verify/email?key=">Verify</a>']) {
  assert.deepEqual(extractAppleVerificationLinks(body), []);
}
console.log('apple verification link tests passed');
