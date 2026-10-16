const { requireProxy } = require('./required-proxy');

// Giả lập hoàn toàn: không mở kết nối mạng và không gửi thư thật.
async function sendMail(email, proxy) {
  requireProxy(proxy);
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Email nhận không hợp lệ.');
  }
  await new Promise(resolve => setTimeout(resolve, 500));
  return { success: true, simulated: true };
}

module.exports = { sendMail };
