// Opt-in: đọc Inbox thật, không tạo alias, không gửi thư và không mở link Apple.
const fs = require('node:fs');
const path = require('node:path');
const { loadPlan } = require('../src/alias-batch');
const { loadProxies } = require('../src/services/required-proxy');
const { MailComAliasClient } = require('../src/services/mailcom-alias');

async function run() {
  const plan = loadPlan({ emailFile: 'data/credentials.mailchinh.txt', aliasFile: 'data/mailphu.txt' });
  if (plan.accounts.length !== 1) throw new Error('Test Inbox thật yêu cầu đúng một mail chính.');
  const proxyFile = process.argv[2] || (fs.existsSync('data/proxy.txt') ? 'data/proxy.txt' : '../data/proxy.txt');
  const client = new MailComAliasClient(() => {}, { proxy: loadProxies(proxyFile)[0] });
  const report = { at: new Date().toISOString(), results: [] };
  try {
    await client.login(plan.accounts[0]);
    const inbox = await client.listInbox();
    report.totalCount = inbox.totalCount;
    for (const job of plan.jobs) {
      const result = await client.waitForAppleVerification({ recipient: job.alias });
      report.results.push({ alias: job.alias, ...result });
    }
  } catch (error) {
    report.error = error.safeMessage || 'Không chạy được test Inbox.';
    process.exitCode = 1;
  } finally {
    await client.close();
    fs.mkdirSync('results', { recursive: true });
    const filename = path.resolve('results/live-inbox-report.json');
    fs.writeFileSync(filename, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ totalCount: report.totalCount, results: report.results.map(({ status, scanned, appleMessages }) => ({ status, scanned, appleMessages })), error: report.error, report: filename }));
  }
}
run().catch(() => { console.error('Kiểm tra file tài khoản, alias và proxy cho test Inbox.'); process.exitCode = 1; });
