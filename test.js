const ProtonMailClass = require("./src/services/protonmail");

async function main() {
  const protonmail = new ProtonMailClass(
    null,                            // proxy
    "taolataiphan@proton.me"            // thay bằng email Proton của bạn
  );

  const result = await protonmail.CheckEmail();
  console.log(result);
}

main().catch(console.error);
