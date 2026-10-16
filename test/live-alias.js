// Opt-in real-account diagnostic. Never included in npm test.
const fs = require('node:fs');
const path = require('node:path');
const { loadPlan } = require('../src/alias-batch');
const { loadProxies } = require('../src/services/required-proxy');
const { MailComAliasClient } = require('../src/services/mailcom-alias');

async function run() {
  const args = process.argv.slice(2);
  const proxyArgs = args.filter(x => !x.startsWith('--'));
  if (args.some(x => x.startsWith('--') && !['--create', '--delete'].includes(x)) || proxyArgs.length > 1 || (args.includes('--create') && args.includes('--delete'))) {
    throw new Error('Chỉ chọn --create hoặc --delete và tối đa một đường dẫn file proxy; mặc định chỉ đọc danh sách alias.');
  }
  const deleting = args.includes('--delete');
  const plan = loadPlan({ emailFile: 'data/credentials.mailchinh.txt', aliasFile: 'data/mailphu.txt' });
  if (plan.accounts.length !== 1 || plan.jobs.length !== 1) throw new Error('Test thật yêu cầu đúng 1 mail chính và 1 alias trong hai file dữ liệu.');
  const job = plan.jobs[0], account = plan.accounts[job.accountIndex];
  const proxyFile = proxyArgs[0] || (fs.existsSync('data/proxy.txt') ? 'data/proxy.txt' : '../data/proxy.txt');
  const client = new MailComAliasClient(() => {}, { proxy: loadProxies(proxyFile)[0] });
  const report = { at: new Date().toISOString(), mode: deleting ? 'delete' : args.includes('--create') ? 'create' : 'read-only', mainEmail: account.email, alias: job.alias };
  try {
    report.stage = 'login';
    await client.login(account);
    report.stage = 'list-before';
    const before = await client.listAddresses();
    report.beforeCount = before.length;
    report.presentBefore = before.some(x => x.address.toLowerCase() === job.alias);
    if (args.includes('--create')) { report.stage = 'add-alias'; report.outcome = await client.addAlias(job.alias); }
    if (deleting) { report.stage = 'delete-alias'; report.outcome = await client.removeAlias(job.alias); }
    report.stage = 'list-after';
    const after = await client.listAddresses();
    report.afterCount = after.length;
    report.verifiedPresent = after.some(x => x.address.toLowerCase() === job.alias);
    if (deleting) {
      report.verifiedRemoved = !report.verifiedPresent;
      if (!report.verifiedRemoved) throw new Error('Alias vẫn còn trong mail chính.');
    }
    report.stage = 'completed';
  } catch (error) {
    report.error = error.safeMessage || 'Lỗi nội bộ khi test';
    if (error.httpStatus) report.httpStatus = error.httpStatus;
    process.exitCode = 1;
  } finally {
    await client.close();
    fs.mkdirSync('results', { recursive: true });
    const filename = path.resolve(deleting ? 'results/live-alias-delete-report.json' : 'results/live-alias-report.json');
    fs.writeFileSync(filename, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ mode: report.mode, stage: report.stage, beforeCount: report.beforeCount, outcome: report.outcome?.status, accountFull: report.outcome?.accountFull, message: report.outcome?.message, afterCount: report.afterCount, verifiedPresent: report.verifiedPresent, verifiedRemoved: report.verifiedRemoved, httpStatus: report.httpStatus || report.outcome?.httpStatus, error: report.error, report: filename }));
  }
}
run().catch(error => { console.error(error.safeMessage || error.message || 'Không chạy được test alias.'); process.exitCode = 1; });
