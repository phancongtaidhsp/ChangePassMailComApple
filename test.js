const MailComClass = require("./src/services/mailcom");

async function main() {
  const mailcom = new MailComClass(
    process.env.MAILCOM_PROXY || null, // hoặc thay bằng proxy của bạn
    process.env.MAILCOM_EMAIL || "your-email@mail.com" // thay bằng email cần kiểm tra
  );

  const result = await mailcom.CheckEmail();
  console.log(result);
}

main().catch(console.error);
