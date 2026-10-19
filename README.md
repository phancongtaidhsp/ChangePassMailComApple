# Mail.com Alias Password Tool

Ứng dụng Electron thêm mail phụ bằng **HTTP request API**, nhận link Apple trong
Inbox, đổi mật khẩu và xóa alias sau khi xử lý. Không mở browser cho từng tài khoản.

## Chạy

```sh
npm install
npm start
```

1. Chọn `data/credentials.mailchinh.txt`, mỗi dòng `email|password`.
   Mọi ký tự sau dấu `|` đầu tiên thuộc mật khẩu, kể cả khoảng trắng.
2. Chọn `data/mailphu.txt`, mỗi dòng một địa chỉ đầy đủ, ví dụ `tenphu@mail.com`.
3. Chọn file `data/proxy.txt` (bắt buộc), mỗi dòng một proxy HTTP/HTTPS.
4. Đặt **Số luồng** (1–200, mặc định 50), khoảng nghỉ (mặc định 1.000 ms) và thư mục kết quả. Khi bắt đầu, số luồng tự giảm xuống bằng số mail chính nếu file có ít tài khoản hơn; giao diện hiển thị số luồng đã điều chỉnh. Mật khẩu mới được tự sinh khi lấy được link.
5. Bấm **Bắt đầu đổi pass alias**.
6. Mở thư mục kết quả: `success.txt` chứa các cặp đổi pass thành công, `fail.txt` chứa lỗi theo alias, `mailchinhfail.txt` chứa mail chính đăng nhập lỗi; `alias-results.jsonl` lưu trạng thái chi tiết.

Bản đóng gói không kèm file tài khoản; chọn lại các file TXT trên máy.

## Chế độ chạy lại record lỗi

Chọn **Chế độ → Chạy lại record lỗi**, chọn file TXT có định dạng:

```text
mail chính|password mail chính|alias|mã lỗi
```

Sau đó chọn proxy, thư mục kết quả, số luồng và bấm **Bắt đầu chạy lại record lỗi**.
Không cần chọn riêng file mail chính/mail phụ. Mật khẩu được giữ nguyên cả khoảng
trắng và dấu `|`; alias và mã lỗi là hai trường cuối. File cũ thiếu password mail
chính phải được bổ sung trước. Dòng lỗi không gắn alias được bỏ qua và hiển thị số
lượng; các dòng sai định dạng hoặc mật khẩu mâu thuẫn cho cùng mail chính được báo
lỗi trước khi bắt đầu. Alias trùng chỉ chạy một lần; nếu có ở nhiều mail chính thì
giữ mail chính của record xuất hiện đầu tiên.

Mỗi mail chính có hàng đợi riêng từ file record. Mỗi luồng đăng nhập một lần, giữ
phiên/proxy và xử lý tuần tự các alias của mail đó; không chuyển alias sang mail
chính khác. Trước mỗi alias, đọc danh sách địa chỉ:

- Đã tồn tại: bỏ qua thao tác thêm và tiếp tục gửi thư, nhận link, đổi pass.
- Chưa tồn tại: thêm alias rồi tiếp tục quy trình như bình thường. Nếu API thêm
  trả về `existing` trong lúc đối chiếu thì vẫn tiếp tục đổi pass.

Retry gửi thư/đọc Inbox/đổi pass/xóa alias và cơ chế dừng sau alias hiện tại giống
chế độ thường. Mọi alias đã có hoặc vừa thêm đều được thử dọn dẹp trước khi kết thúc.
Nếu gặp giới hạn tạo địa chỉ, record đó thất bại nhưng vẫn kiểm tra các record tiếp
theo của cùng mail chính, vì chúng có thể đã tồn tại. Mail chính đăng nhập lỗi được
ghi `mailchinhfail.txt`; các alias của mail đó còn chưa chạy được báo trong thống kê.

Kết quả append vào `success.txt`, `fail.txt`, `mailchinhfail.txt` và JSONL với định
dạng như chế độ thường. Có thể chọn chính `fail.txt` ở thư mục kết quả làm đầu vào:
danh sách được nạp một lần lúc bắt đầu, các dòng mới append không bị chạy lại ngay.
File record đầu vào chỉ được lọc khi bấm **Xuất kết quả**: xóa các record có alias
đã thành công, có mã `unable_add_alias` trong kết quả, hoặc thuộc mail chính có mã
`main_login_failed`; giữ các record còn lại. Việc lọc dùng các file TXT đã lưu, gồm
cả lịch sử các lượt trước, và không tạo `.bak`.

## Proxy bắt buộc

Không có chế độ non-proxy. File proxy phải tồn tại, có ít nhất một dòng hợp lệ.
Các định dạng được hỗ trợ:

```text
127.0.0.1:8080
127.0.0.1:8080:username:password
http://username:password@proxy.example:8080
https://username:password@proxy.example:8443
```

Thay các ví dụ bằng proxy thực của bạn. Không hỗ trợ SOCKS. Proxy được phân bổ xoay
vòng theo mail chính và giữ nguyên cho đến khi xử lý xong alias; có thể dùng chung một proxy
cho nhiều mail chính. Đăng nhập, redirect, token, đọc/thêm/xóa alias và logout đều đi qua
HTTPS CONNECT agent. `proxy: false` trong Axios chỉ tắt cơ chế proxy từ biến môi
trường để dùng agent đã cấu hình, không phải kết nối trực tiếp. Proxy lỗi hoặc trả
407 lúc đăng nhập được ghi vào `mailchinhfail.txt` rồi chuyển mail chính; nếu lỗi sau đăng nhập thì ghi `fail.txt` và tiếp tục alias khác. Không tự đổi sang IP máy. Không ghi thông tin xác thực proxy vào
bảng kết quả hoặc JSONL.

`AliasBatch` có thể nhận dependency `sendMail(email, proxy)` trong tham số thứ
hai của constructor. Proxy truyền vào là chuỗi gốc trong file (bỏ khoảng trắng đầu/cuối), cùng proxy
của mail chính. Hàm phải tự sử dụng proxy cho request gửi thư, không được fallback
trực tiếp. Trả `true`, `'successfully'` hoặc `{ success: true }` để hiện “Gửi mail thành công”.

Hiện `src/main.js` đã nối hàm giả lập trong `src/services/send-test-email.js` vào batch.
Hàm nhận `(email, proxy)`, kiểm tra đầu vào, chờ 500 ms rồi trả
`{ success: true, simulated: true }`; không mở kết nối mạng, không gửi thư thật.
Bảng kết quả hiện “Gửi mail thành công (giả lập — không gửi thư thật)” sau khi
thêm alias thành công. Phần đăng nhập/thêm alias vẫn chạy thật qua proxy; chỉ bước
gửi thư là giả lập. Kết quả gửi và đọc Inbox hiển thị trong giao diện, đồng thời
ghi thêm dòng `event: "mail-followup"` vào JSONL. Thay phần thân hàm này khi tích hợp gửi thư thật.

## Đọc Inbox và trích xuất link Apple

Sau khi hàm gửi trả thành công, tool giữ nguyên phiên đăng nhập và proxy của mail
chính để đọc Inbox. Module `src/services/mailcom-inbox.js` lấy token riêng với scope
`mail_mailbox_r`, rồi gọi:

- POST `https://maillist.mail.com/Mailbox/Mail`, tham số `folderTypeOrId=INBOX`,
  `offset`, `amount=50`, `orderBy=INTERNALDATE DESC`.
- GET `https://webmail-cats-live.mail.com/mailbox/primary/mailheader/{mailId}?absoluteURI=false`.
- GET `https://webmail-cats-live.mail.com/mailbox/primary/mailbody/{mailId}/Body?absoluteURI=false`,
  nhận HTML bằng `Accept: text/vnd.ui.secure-v3+html; generateInlineLinks=embed`.

Endpoint, OAuth client và media type đối chiếu từ cấu hình/bundle chính thức
`webmailer-mail-list 7.4.2` và `webmailer-mail-detail 8.2.3`; đã kiểm chứng request
danh sách, header và body trên tài khoản thật. API nội bộ có thể thay đổi.

Tool lọc địa chỉ người gửi thuộc `apple.com`/subdomain và người nhận To/Cc/Bcc khớp
chính xác alias đang xử lý. Sau đó đọc nội dung thư và trích URL bắt đầu bằng
`https://iforgot.apple.com/verify/email?key=` với key không rỗng. HTML entities như
`&amp;` và lớp bọc `https://deref-gmx.com/r/` được giải mã tại chỗ, không mở URL Apple
hay URL chuyển hướng. Không thực thi HTML hoặc tải ảnh/attachment trong thư.

Nếu HTML đã lọc (`secure-v3`) không có link khớp, tool đọc lại Body của cùng mã thư
với `Accept: text/plain` rồi trích URL. Một số thư bị mail.com bỏ tham số `to` khỏi
link deref trong HTML dù bản text vẫn có đầy đủ link xác minh.

Hàm `sendMail` được gọi tối đa **5 lần tổng cộng** cho mỗi alias, gồm cả những lần
trả lỗi hoặc throw. Nghỉ 2 giây trước lần gửi tiếp theo. Chỉ đọc Inbox sau lần gửi
thành công: quét tối đa 5 lượt, nghỉ 2 giây giữa các lượt; mỗi lượt quét tối đa
5 trang × 50 thư mới nhất. Nếu gửi lỗi hoặc quét chưa có link thì tiếp tục gửi
trong ngân sách còn lại; tìm được link thì dừng gửi ngay. Hết 5 lần gọi vẫn chưa
có link thì xóa alias, ghi `fail.txt` và hoàn tất cặp. Khi gửi thật, chỉ xét thư từ thời
điểm bắt đầu từng lần gửi; khi gửi giả lập, xét cả thư hiện có.

Kết quả có `sendStatus`, `sendAttempts`, `inboxStatus`, `inboxMessage`; khi tìm thấy
có thêm `verificationLink` và `appleMessageId`. Link được lưu trong
`alias-results.jsonl` nhưng không hiển thị trên bảng; không ghi toàn bộ nội dung thư.
Các dòng `mail-followup` là cập nhật cho cùng `jobId`, không phải alias mới.

API lấy danh sách, đọc header, nội dung HTML và bản text của thư thử tối đa **3 lần
tổng cộng** cho từng request (gồm lần đầu), nghỉ **2 giây** giữa các lần lỗi; thành
công thì dừng retry ngay. Áp dụng cho lỗi kết nối/timeout, HTTP lỗi và phản hồi sai
định dạng. Tham số đầu vào không hợp lệ và request đã bị hủy không retry. Lấy token
có ngân sách riêng tối đa 3 lần với lỗi tạm thời, không lồng thành 3 × 3 lần.
Đây là retry request, tách biệt với 5 lượt quét tìm thư sau mỗi lần gửi.

Lỗi API/token/dữ liệu khi đã hết retry đọc Inbox kết thúc alias hiện tại: thử xóa alias, ghi
`fail.txt` rồi chạy alias tiếp theo. Nếu đã bấm Tạm dừng, luồng hoàn tất alias hiện tại
rồi dừng, không lấy alias mới.

Kiểm tra Inbox thật riêng, không tạo alias/gửi thư:

```sh
npm run test:inbox:live
# Hoặc chỉ định file proxy:
npm run test:inbox:live -- /duong/dan/proxy.txt
```

Lệnh này dùng đúng một mail chính trong `data/credentials.mailchinh.txt`, kiểm tra
các alias trong `data/mailphu.txt`, lưu `results/live-inbox-report.json`. Mặc định
tìm proxy ở `data/proxy.txt`, rồi `../data/proxy.txt`. Console không in token/link;
link tìm thấy chỉ nằm trong file kết quả cục bộ.

## Đổi mật khẩu giả lập sau khi lấy link

Luồng chính gọi `changePassword(newPassword, url, proxy)` trong
`src/services/change-password.js` sau khi tìm được link Apple. `newPassword` lấy từ
`generatePassword()` trong `src/helper/helper.js`, `url` là link vừa trích xuất,
`proxy` là chuỗi proxy gốc của mail chính, không chuyển thành object hoặc URL chuẩn hóa
trước khi gọi `sendMail`/`changePassword`. Mỗi cặp sinh mật khẩu một lần, giữ cùng mật khẩu
qua các lần thử, kể cả khi đang chờ dừng sau alias. Định dạng giữ nguyên: 3 chữ hoa, 2 số,
1 chữ thường, 3 số, ký tự `@`, 3 chữ thường; dùng `crypto.randomInt` để sinh ký tự.
Hàm hiện chỉ kiểm tra đầu vào, chờ 500 ms rồi trả chuỗi `successfully`; không gọi
Apple, không mở link và không đổi mật khẩu thật.

Chỉ chuỗi chính xác `successfully` được coi là thành công. Giá trị khác hoặc lỗi
throw sẽ thử lại, tổng cộng tối đa 5 lần gọi, nghỉ 2 giây giữa các lần thất bại.
Thành công thì dừng ngay; hết 5 lần thì ghi thất bại. Trước khi hoàn tất, tool gọi API
xóa alias và đọc lại danh sách địa chỉ để xác nhận alias đã biến mất.

Sau khi đã thêm alias thành công, mọi nhánh kết thúc đều đi qua bước dọn dẹp xóa
alias, gồm gửi thư thất bại (trả lỗi hoặc throw), không có link sau tối đa 5 lần gọi gửi,
hết lượt đổi pass, thiếu cấu hình hoặc lỗi xử lý kết thúc khác. Nếu chưa xóa được
alias của cặp thất bại, ghi cả nguyên nhân ban đầu và lỗi dọn dẹp vào `fail.txt`,
kết thúc cặp và lấy alias tiếp theo trên cùng mail chính. Không tự thử xóa lại alias
đã kết thúc. Đổi pass đã thành công vẫn ghi `success.txt` dù dọn dẹp bị lỗi.

Các luồng độc lập: lỗi của một tài khoản không gọi cơ chế dừng chung, không hủy
request hoặc dừng cấp alias cho các luồng khác. Đăng nhập không được (sau retry)
thì ghi `mailchinhfail.txt` theo dạng `mail chính|main_login_failed`, đóng phiên và lấy
mail chính khác chưa thuộc luồng nào. Chỉ cấp alias sau khi đăng nhập thành công,
nên đăng nhập lỗi không tiêu hao alias. Mọi lỗi sau đăng nhập kết thúc alias đang
chạy vào `fail.txt`, dọn dẹp nếu đã thêm alias hoặc request tạo đã gửi mà chưa rõ
kết quả, rồi tiếp tục alias tiếp theo. Không có trạng thái tự chờ người dùng do lỗi.
Khi hết alias hoặc hết tài khoản có thể dùng, lượt kết thúc bình thường và báo phần
chưa chạy. Chỉ yêu cầu Tạm dừng/đóng ứng dụng từ người dùng mới dừng chung.

Kết quả hiển thị rõ là giả lập và ghi `passwordChangeStatus`,
`passwordChangeAttempts`, `passwordChangeMessage` vào JSONL. Mật khẩu mới chỉ giữ
trong bộ nhớ và không đưa vào snapshot/log/JSONL. Khi đổi pass thành công, tool thử
xóa alias rồi ghi `mail chính|password mail chính|alias|mật khẩu mới` vào `success.txt`; xóa alias lỗi vẫn
được tính là đổi pass thành công; lỗi dọn dẹp được ghi thêm vào `fail.txt` và JSONL. Nếu bước đổi pass kết thúc
không thành công, tool ghi `mail chính|password mail chính|alias|mã lỗi` vào `fail.txt`. Tạm dừng vẫn chạy
hết các lượt thử của alias hiện tại, dọn dẹp và xuất kết quả trước khi dừng.

`AliasBatch` nhận dependency `changePassword` và `generatePassword` để kiểm thử các
kết quả khác nhau. Không cần truyền `options.newPassword`. Lệnh `test:inbox:live`
vẫn chỉ kiểm tra đọc Inbox; test luồng đổi mật khẩu giả lập nằm trong `npm test`.

## Mỗi mail chính xử lý nhiều alias

Mỗi luồng đăng nhập một mail chính, giữ cookie/token và proxy riêng để xử lý tuần tự
nhiều alias trong cùng phiên. Luồng hoàn tất gửi thư, đọc link, đổi pass và dọn dẹp
alias hiện tại rồi mới lấy alias tiếp theo. Alias bị từ chối hoặc đã tồn tại cũng
kết thúc lượt xử lý alias đó, sau đó tiếp tục trên cùng mail chính. Chỉ khi tài khoản
đạt giới hạn **Maximum number of email addresses created**, luồng đóng phiên và
lấy mail chính tiếp theo. Ví dụ 10 luồng giữ tối đa 10 mail chính cùng lúc.

Hàng đợi alias dùng chung cấp từng địa chỉ duy nhất bằng thao tác đồng bộ. Alias
đã cấp không được chuyển sang luồng/tài khoản khác hoặc chạy tạo lại trong lượt đó,
kể cả khi mail chính báo đầy. Dòng trùng (không phân biệt hoa/thường) được bỏ qua.
Khi hết alias hoặc mọi mail chính đã đạt giới hạn, lượt kết thúc và báo số alias
thành công, thất bại, còn chưa chạy. Tiến độ tính theo tổng alias sau khi bỏ trùng.
File đầu vào được giữ nguyên cho tới khi bấm **Xuất kết quả**; lượt chạy mới là hàng đợi mới.

Tạm dừng ngừng cấp alias và mail chính mới. Mỗi luồng giữ phiên để xử lý hết alias đã
nhận, kể cả gửi lại thư, đọc Inbox, retry đổi pass và xóa alias. Khi tất cả luồng đã
đóng phiên, các nút chọn file, cấu hình và Bắt đầu được bật lại. Không có nút Tiếp tục;
có thể xuất kết quả rồi bắt đầu lượt mới với dữ liệu còn lại.

Alias dùng chung hộp thư và mật khẩu với mail chính. Mỗi tài khoản có tối đa 10 địa chỉ,
tính cả mail chính và các alias đã có. Đây không phải email khôi phục.
Tham khảo [hướng dẫn mail.com](https://support.mail.com/email/settings/aliasaddresses.html).

## Luồng HTTP

1. GET trang mail.com, đọc form cùng các trường ẩn hiện tại.
2. POST `https://login.mail.com/login`, theo chuyển hướng bằng cookie jar riêng.
3. Đọc URL `/halogin` do mail.com trả về và hoàn tất phiên; không chạy JavaScript.
4. Đọc `navsid` trong cấu hình Mail Settings, đổi sang token tại
   `https://oauthbridge.navigator-lxa.mail.com/navigator/oauth2/token`.
5. GET danh sách địa chỉ và domain từ `https://settings-cats.mail.com`.
6. Kiểm tra đúng tài khoản, alias đã có, giới hạn địa chỉ và tên miền.
7. POST `/mailaccount/emailAddressValidations?absoluteURI=false` với danh sách `[alias]`; chỉ tạo nếu trả về object rỗng như webmail.
8. POST `/mailaccount/primary/emailAddresses?absoluteURI=false` với media type
   `application/vnd.ui.trinity.minimalmailaddress-v3+json`.
9. GET lại danh sách để xác nhận alias đã xuất hiện.
10. Sau khi xử lý xong, POST `/mailaccount/primary/emailAddressesRemovals/{alias}/removals?absoluteURI=false` với body rỗng, Content-Type/Accept `text/plain;charset=UTF-8` theo bundle `mailset-compose`; GET lại danh sách để xác nhận alias đã biến mất.
11. Gửi logout nếu có URL từ phiên.

Endpoint và payload đối chiếu từ bundle chính thức `mailset-root 1.0.7-build.262`
và `mailset-compose 1.0.8-build.377` ngày 2026-10-15. Đây là API nội bộ của webmail,
có thể thay đổi.

Cookie/token chỉ giữ trong bộ nhớ từng client, xóa sau khi đóng phiên. Chỉ gửi request
tới HTTPS mail.com; không chuyển tiếp mật khẩu bằng redirect POST sang host khác.
Không ghi cookie hoặc token vào kết quả. Mật khẩu mail chính chỉ được thêm vào `success.txt` và `fail.txt`,
không đưa vào bảng, snapshot hay JSONL. Khi gặp yêu cầu xác minh, 401/403/424
hoặc giới hạn 429, ghi lỗi vào file tương ứng và tiếp tục lượt tiếp theo.
Không tự mở browser hoặc vượt qua xác minh.

## Kết quả và tiếp tục

`success.txt` ghi mỗi dòng `mail chính|password mail chính|alias|mật khẩu mới` khi `changePassword`
trả đúng `successfully`, kể cả khi xóa alias thất bại. `fail.txt` ghi `mail chính|password mail chính|alias|mã lỗi` khi tạo alias,
gửi thư, tìm link hoặc đổi pass kết thúc không thành công. Cả hai file ghi nối tiếp,
quyền file là chỉ chủ máy đọc/ghi.

Mật khẩu mail chính trong `success.txt` và `fail.txt` lấy từ file tài khoản của lượt chạy, giữ nguyên
ký tự, khoảng trắng và dấu `|`. Mọi loại lỗi trong file này đều dùng định dạng mới,
kể cả lỗi dọn dẹp, ghi file và đóng phiên. Nút Xuất kết quả đọc được cả dòng cũ
`mail chính|alias|mã lỗi` và dòng mới; alias/mã lỗi được đọc từ hai cột cuối.
Nút cũng đọc được định dạng `success.txt` cũ `mail chính|alias|mật khẩu mới` và định
dạng mới có password mail chính. Với dòng mới, alias/mật khẩu mới là hai cột cuối.

`mailchinhfail.txt` ghi `mail chính|main_login_failed` khi đăng nhập thất bại. Không ghi
mật khẩu đăng nhập vào file này. Một mail chính chỉ được giao cho một worker tại
một thời điểm; tài khoản đăng nhập lỗi không được tự cấp lại trong cùng lượt.

Các mã lỗi TXT: `unable_add_alias`, `alias_already_exists`, `send_mail_failed`,
`apple_link_not_found`, `inbox_read_failed`, `password_generation_failed`,
`password_change_failed`, `password_change_not_configured`, `alias_cleanup_failed`,
`alias_processing_failed`, `result_write_failed`, `session_close_failed` và
`main_login_failed`. Mô tả chi tiết vẫn hiển thị trong bảng và JSONL. Khi vừa lỗi
xử lý vừa lỗi xóa alias, `fail.txt` ghi hai dòng mã lỗi; thống kê chỉ tính một alias thất bại.
Các dòng từ lượt cũ vẫn được giữ nguyên vì file kết quả ghi append.

Nút **Xuất kết quả** luôn bấm được khi tool không chạy, kể cả trước lượt đầu hoặc sau
khi đã xuất. Chỉ bị vô hiệu khi đang chạy hoặc đang chờ các luồng hoàn tất để dừng.
Mỗi lần bấm, tool đọc lại `success.txt`, `fail.txt`, `mailchinhfail.txt` trong thư mục
kết quả đang chọn, rồi lọc file mail chính/mail phụ đang chọn. Không dùng danh sách
kết quả trong RAM hay JSONL để quyết định xóa dòng. Dùng cả lịch sử đã append từ các
lượt trước, kể cả sau khi mở lại ứng dụng; không cần chạy lượt mới hoặc chọn proxy.
Còn kết quả chưa ghi được thì thử ghi lại và báo lỗi nếu vẫn không lưu được, chưa
lọc đầu vào. Khi có kết quả:

- Xóa mọi dòng trùng alias trong `success.txt` hoặc có mã `unable_add_alias` trong
  `fail.txt` khỏi file mail phụ đang chọn, bao gồm trường hợp giới hạn tạo địa chỉ.
- Xóa mail chính có mã `main_login_failed` trong `mailchinhfail.txt` khỏi file mail chính đang chọn.
- Giữ alias đã tồn tại (`existing`), alias chưa chạy và alias lỗi sau khi đã thêm
  nhưng chưa đổi pass thành công, trừ khi địa chỉ đó có trong kết quả thành công hoặc
  `unable_add_alias` của lượt khác đã lưu trong cùng thư mục.
- Cập nhật file đầu vào, giữ nguyên nội dung, BOM và kiểu xuống dòng của các dòng còn lại.

Không sửa đầu vào trong lúc chạy hoặc khi đang chờ dừng. Khi xuất, dùng đúng ba
đường dẫn đang chọn: file mail chính, file mail phụ và thư mục kết quả; ở chế độ
chạy lại là file record lỗi và thư mục kết quả. File TXT kết quả được giữ nguyên
trừ khi nó cũng là file record lỗi được chọn để lọc. File kết quả chưa tồn tại được xem là chưa có dữ liệu;
dòng sai định dạng được bỏ qua và thông báo số dòng. Lỗi đọc file khác chặn lọc
trước khi sửa đầu vào. Bấm xuất lại sẽ đọc lại kết quả mới trên đĩa; dòng đã xóa
không bị đếm lại. Nếu cập nhật một file lỗi, có thể thử lại. Số dòng thông báo là
số thực sự xóa ở lần bấm đó. File kết quả vẫn được tự lưu nối tiếp trong lúc chạy.

Nếu hết dung lượng hoặc mất quyền ghi, worker vẫn tiếp tục. Kết quả chưa lưu (kể cả
mật khẩu thành công) được giữ trong bộ nhớ và thử ghi lại khi có cập nhật kết quả
tiếp theo. Lỗi ghi cũng được xếp chờ vào `fail.txt`. Giao diện hiển thị số bản ghi
chưa lưu và nút **Thử ghi lại** để dùng sau khi sửa dung lượng/quyền ghi. Không thể
cam kết đã xuất file khi hệ điều hành vẫn từ chối ghi; đóng ứng dụng sẽ mất bộ đệm.
Lượt mới chỉ bắt đầu khi đã ghi hết bộ đệm, để tránh làm mất kết quả lượt trước.

`alias-results.jsonl` ghi trạng thái chi tiết `mainEmail`, `alias`, `status`, `message`, `at`:

- `added`: API đọc lại xác nhận alias đã có trong đúng mail chính.
- `existing`: alias đã có trước khi gửi POST; không tạo lại.
- Lỗi/chưa xác nhận tạo alias được kết thúc với `failed` và ghi `fail.txt`, không tự giữ chờ hoặc tạo lại alias đó.
- `failed`: hết chỗ, tên miền không hỗ trợ, tên không hợp lệ hoặc API từ chối
  bằng HTTP 400/409/412/422. Thông báo ghi mã lỗi, không xuất phản hồi chứa thông tin phiên.

Các bước tải form/đăng nhập, lấy token Settings/Inbox, đọc danh sách alias, đọc domain
và kiểm tra tên alias gọi tối đa **3 lần tổng cộng** (gồm lần đầu), nghỉ **2 giây**
giữa các lần thất bại. Retry áp dụng cho lỗi mạng/timeout, HTTP 408/429 và 5xx.
Yêu cầu xác minh SMS, từ chối xác thực 401/403/407/424, dữ liệu sai định dạng hoặc
địa chỉ không hợp lệ không được gửi lặp lại. Mỗi luồng tự retry trên cùng proxy.

Request tạo alias chỉ gửi một lần. Sau đó đọc lại danh sách tối đa **3 lần**, cách
nhau **2 giây** để xác nhận. Không lồng thêm 3 lần retry vào mỗi lượt xác nhận.
Request xóa alias gửi tối đa **3 lần**, nghỉ **2 giây**, khi gặp lỗi tạm thời hoặc
HTTP **401/403/407/424**. Quy tắc mở rộng này chỉ áp dụng cho request xóa alias. Trước khi gửi lại,
tool đọc danh sách: alias đã biến mất thì kết thúc ngay, không gửi xóa lần nữa.
Nếu POST xóa bị timeout/chưa rõ kết quả mà chưa đối chiếu được, chuyển sang xác
nhận cuối. Nếu POST đã bị từ chối bằng 401/403/407/424 thì vẫn thử tiếp trong ngân
sách 3 lần khi GET đối chiếu cũng lỗi xác thực/kết nối. Dừng gửi lại nếu phát hiện
alias đã thành địa chỉ mặc định hoặc không cho phép xóa. Sau khi
gửi xong, đọc lại danh sách tối đa **3 lần**, cách nhau **2 giây** để xác nhận xóa.
Thành công hoặc đã xác nhận alias không còn thì dừng ngay. Tạm dừng không gửi thêm
alias mới; các request và retry cần thiết cho alias hiện tại vẫn chạy đến kết quả cuối.

Timeout mặc định là 20 giây/request, riêng danh sách Inbox là 32 giây và logout
là 5 giây. Request Mail.com còn có thời hạn hủy bằng AbortController để giới hạn
cả lúc proxy chưa kết nối xong. Các request phụ được `sendMail` gọi cũng có timeout
20 giây. Đây là thời hạn từng request, không phải tổng thời gian một lần gọi
`sendMail`: `getCaptchaResult` đọc kết quả tối đa 10 lượt, nghỉ 1 giây giữa các lượt
chưa có kết quả; `getCaptchaResultNope` giữ giới hạn 120 lượt, nghỉ 2 giây. Vì thế
toàn bộ bước gửi vẫn có thể kéo dài nhiều phút. `getCaptchaResult` hủy request
khi hết 20 giây và trả chuỗi rỗng nếu thiếu ID, dữ liệu không hợp lệ, request lỗi
hoặc hết lượt chờ. Các bước HTTP của Apple trả trực tiếp
Promise của request để lỗi đọc dữ liệu/cookie/chuyển hướng được trả về cho vòng
retry, không bị kẹt trong một Promise bọc ngoài.

Nếu POST tạo alias timeout hoặc chưa rõ kết quả, tool đối chiếu bằng GET;
nếu vẫn chưa xác nhận thì ghi thất bại, thử dọn dẹp alias đó và lấy alias tiếp theo.
Không gửi lại request tạo alias đó. HTTP thành công riêng lẻ
chưa đủ để báo `added`.

**Tạm dừng** ngừng nhận alias mới và không hủy các request đang xử lý. Mỗi luồng phải
xử lý xong alias hiện tại, dọn dẹp, lưu kết quả và đóng phiên trước khi lượt kết thúc.
Trong thời gian đó giao diện hiện Đang tạm dừng; xong thì các nút trở về trạng thái
không chạy, có thể xuất kết quả hoặc bắt đầu lượt mới. File đầu vào giữ nguyên cho tới
khi bấm Xuất kết quả.
Sau khi đóng ứng dụng, có thể chạy lại cùng file/cấu hình; alias đã có được nhận diện
qua API. Lịch sử JSONL có thể chứa cùng cặp ở nhiều lượt.

## Kiểm thử

```sh
npm test
npm run test:ui
npm run test:proxy
npm run package
```

Test giả lập kiểm tra form đăng nhập, cookie, chuyển hướng, payload tạo alias, xác nhận
đúng tài khoản, tránh retry POST, kết quả timeout, giới hạn số luồng, hoàn tất alias khi tạm dừng
và giao diện Electron. Test UI chỉ mở cửa sổ điều khiển, không mở browser mail.com.

Đã kiểm thử thật đăng nhập, tạo alias biến thể được người dùng cho phép bằng HTTP API,
đóng phiên và đăng nhập lại xác nhận alias tồn tại (2026-10-15). Tên gốc bị cả API và
webmail từ chối; biến thể có hậu tố tạo thành công. Không tự đổi tên mail phụ trong tool.
Báo cáo cục bộ: `results/live-variant-report.json` (không chứa mật khẩu/token).

Test thật một cặp (không nằm trong `npm test`):

```sh
node test/live-alias.js           # Chỉ đăng nhập và đọc để xác nhận
npm run test:alias:add:live       # Thực sự thêm alias từ hai file đầu vào
npm run test:alias:delete:live    # Thực sự xóa alias từ mail chính
```

Lệnh xóa yêu cầu đúng 1 mail chính trong `data/credentials.mailchinh.txt`, đúng 1
alias trong `data/mailphu.txt`. Proxy được tìm ở `data/proxy.txt`, rồi
`../data/proxy.txt`; có thể chỉ định bằng `npm run test:alias:delete:live -- /duong/dan/proxy.txt`. Báo cáo lưu tại
`results/live-alias-delete-report.json`; `verifiedRemoved: true` xác nhận alias
không còn trong danh sách địa chỉ của mail chính.

Script yêu cầu `data/proxy.txt` hợp lệ và đúng một cặp, ghi `results/live-alias-report.json` và không sửa file đầu vào.

## Source

- `src/main.js`, `src/preload.js`: cửa sổ điều khiển và IPC.
- `src/alias-batch.js`: ghép cặp, chạy nhiều luồng, lưu kết quả.
- `src/services/mailcom-alias.js`: HTTP client đăng nhập, token, đọc/thêm alias.
- `src/ui/`: giao diện.
- `test/alias-api.test.js`, `test/alias-batch.test.js`: test API và hàng đợi.

### HTTP 412 và bảng kết quả

HTTP 412 ở bước tạo alias được ghi là `failed`, hiện **Không thể add mail phụ** và
lưu `httpStatus`. Luồng thử mail phụ tiếp theo với cùng mail chính; nếu hết địa chỉ
thì báo rõ kết quả, ví dụ 0/1 thành công. Phản hồi CATS che nguyên nhân nên không tự
kết luận tên đã được dùng. Lỗi đăng nhập được ghi `mailchinhfail.txt` rồi chuyển mail
chính. Giới hạn 429 hoặc kết quả chưa rõ sau đăng nhập được ghi `fail.txt` rồi xử lý
alias tiếp theo; các luồng không tự dừng vì lỗi.
