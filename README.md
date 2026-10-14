# Mail.com Email Checker

Ứng dụng Electron kiểm tra email qua API đăng ký mail.com. Không cần mật khẩu,
không đăng nhập vào hộp thư, không tạo tài khoản hoặc gửi email.

## Chạy ứng dụng

Dùng Node.js 18 trở lên (khuyến nghị bản LTS còn được hỗ trợ).

```sh
npm install
npm start
```

1. Chọn file TXT trong thư mục `data`, mỗi dòng một địa chỉ thuộc các domain mail.com hỗ trợ.
2. Có thể chọn file proxy HTTP/HTTPS, mỗi dòng một proxy; để trống để kết nối trực tiếp.
3. Chọn thư mục kết quả, số luồng (1–200) và thời gian nghỉ giữa hai email trên mỗi luồng (tối thiểu 1 giây).
4. Bắt đầu kiểm tra. Tạm dừng sẽ chờ các yêu cầu đang chạy hoàn tất và lưu kết quả.
5. Tiếp tục để xử lý phần còn lại trong cùng lượt; “Lượt kiểm tra mới” ghi nối tiếp vào ba file kết quả trong thư mục đã chọn.

Dòng trống và địa chỉ trùng (không phân biệt chữ hoa/thường) được bỏ qua.
File cũ dạng `email|password|recoveryEmail` được chấp nhận: chỉ lấy email đầu dòng,
không lưu các trường còn lại. File đầu vào chỉ được lọc khi bấm “Xuất kết quả”. Alias `+tag` và tên miền riêng
không được hỗ trợ; chúng được ghi vào nhóm chưa xác định.

Proxy hỗ trợ `host:port`, `host:port:user:password`, `user:password:host:port`
và `http://user:password@host:port`. Mỗi luồng dùng cố định một proxy trong lượt đó.
Không tự đổi proxy hoặc gửi lại yêu cầu khi bị chặn khu vực/yêu cầu xác minh.
Nếu IP/khu vực không được mail.com hỗ trợ đăng ký, tool báo `REGION_BLOCKED`
cho email đó và tiếp tục danh sách. Chọn proxy của bạn qua file TXT; thông tin proxy không được ghi vào mã
nguồn hoặc thư mục kết quả. Tool lấy token, phiên bản ứng dụng và các domain được
hỗ trợ trực tiếp từ cấu hình trang `https://signup.mail.com/`.
Lỗi kết nối, timeout và HTTP 302/401/403/408/429/500/502/503/504 được thử lại tối đa 3 lần
sau lần đầu (tối đa 4 lần kiểm tra). HTTP 401 xóa phiên cũ và lấy phiên mới để kiểm tra
lại cùng email. Khoảng nghỉ tăng dần 1, 2, 4 giây; nếu có `Retry-After` thì chờ ít nhất
theo thời gian máy chủ yêu cầu. HTTP 429 thiếu/sai `Retry-After` chờ ít nhất 30 giây.
Nếu máy chủ yêu cầu chờ hơn 5 phút, email giữ `unknown` kèm thông báo kiểm tra lại sau,
không gửi sớm hơn yêu cầu. Ngân sách dùng chung cho tải cấu hình, lỗi mạng và lỗi HTTP.
Chỉ kết quả cuối cùng được lưu và tính vào bộ đếm; nếu hết lượt thử lại thì email vào
`unknown.txt` với thông báo đã hết 3 lần thử lại. Không retry lỗi email/domain không hợp lệ,
HTTP 407/424, chặn khu vực hoặc phản hồi sai định dạng. HTTP 403 được thử lại với
cùng proxy/phiên; nếu vẫn bị từ chối sau 3 lần retry thì giữ `unknown`.
HTTP 302 thử lại URL gốc, không tự theo địa chỉ chuyển hướng. Riêng chuyển hướng
đến trang từ chối khu vực được ghi `REGION_BLOCKED` và không retry.

## Xuất kết quả và chạy lại

Sau khi tạm dừng hoặc hoàn tất, bấm **Xuất kết quả** để xóa khỏi file đầu vào các dòng
email có kết quả live/die đã lưu thành công trong lượt hiện tại. Giữ nguyên các dòng
unknown và chưa kiểm tra, kể cả thông tin bổ sung sau dấu `|`. Nút tác động đến file
đã dùng cho lượt kiểm tra, không phải file vừa chọn khác trên giao diện. Bấm lại không
làm ghi lặp kết quả. Ba file kết quả vẫn giữ lịch sử và tiếp tục append.

Sau đó bấm **Lượt kiểm tra mới** để đọc lại file đã lọc và kiểm tra phần còn lại, gồm
cả unknown. Nếu file không còn email thì không cần chạy tiếp. **Tiếp tục** chỉ chạy
phần chưa kiểm tra trong lượt đang tạm dừng, không kiểm tra lại unknown của lượt đó.

## Ý nghĩa kết quả

| Nhóm | File | Ý nghĩa |
| --- | --- | --- |
| Còn đăng ký được | `die.txt` | API cho phép đăng ký tên này |
| Không khả dụng | `live.txt` | Tên đã dùng hoặc bị giữ lại; chưa xác nhận hộp thư đang tồn tại |
| Chưa xác định | `unknown.txt` | Email không hợp lệ, lỗi mạng/API, giới hạn hoặc xác minh |

Tên file live/die là quy ước xuất kết quả; API đăng ký không xác nhận khả năng nhận thư
hay trạng thái hoạt động của tài khoản.

Lưu trực tiếp vào thư mục đã chọn (mặc định `Documents/MailComEmailChecker/results/`),
không tạo thư mục con theo lượt. Chỉ xuất `live.txt`, `die.txt`, `unknown.txt`, mỗi dòng
một email. Bắt đầu lượt mới ghi nối tiếp vào ba file này, giữ nguyên kết quả cũ; các file/thư mục cũ khác không bị xóa.
Kết quả được lưu ngay sau từng email. Email được kiểm tra lại ở lượt mới có thể xuất hiện thêm một lần trong file; tạm dừng/tiếp tục cùng lượt không ghi lặp. Chi tiết lỗi và bộ đếm hiển thị trong giao diện,
không xuất nhật ký hoặc tổng kết riêng. Không lưu token phiên hoặc mật khẩu proxy.
Không cho chọn file đầu vào trùng một trong ba file kết quả để giữ nguyên dữ liệu đầu vào.

Tạm dừng/tiếp tục trong cùng phiên ứng dụng giữ các email đã xử lý và không xóa kết quả.
Sau khi đóng ứng dụng, không lưu danh sách chờ riêng. Để kiểm tra lại `unknown.txt`,
chọn thư mục kết quả khác hoặc sao chép file đầu vào sang vị trí khác trước khi chạy.
Số luồng là số email xử lý đồng thời, không phải giới hạn tổng email. Ví dụ 50 luồng
sẽ lần lượt xử lý hết 500 email. Email gặp lỗi API, chặn khu vực, xác minh hoặc lỗi
phiên được lưu vào `unknown.txt` sau khi áp dụng retry phù hợp; các luồng vẫn nhận email
tiếp theo. Nếu kết quả cuối vẫn là HTTP 429, luồng chờ theo `Retry-After`
(hoặc 30 giây nếu thiếu/sai định dạng), tối thiểu bằng khoảng nghỉ đã cấu hình.
Không đổi proxy để né giới hạn.
Lượt chỉ tạm dừng khi người dùng bấm Tạm dừng/đóng cửa sổ, hoặc dừng do lỗi nội bộ,
lỗi đọc/ghi file. Chọn `unknown.txt` để kiểm tra lại các email chưa xác định sau đó.

## Kiểm thử và đóng gói

```sh
npm test              # Kiểm thử giả lập, không gọi mail.com
npm run test:ui       # Mở Electron kiểm thử giao diện với dữ liệu giả
npm run check:email   # Gọi mail.com thật với email trong test.js
npm run package       # Đóng gói ứng dụng cho máy hiện tại
npm run make          # Tạo bộ cài theo cấu hình Electron Forge
```

Sửa email/proxy trong `test.js` để kiểm tra riêng một email, hoặc truyền biến môi trường
`MAILCOM_EMAIL` và `MAILCOM_PROXY`. Không đưa mật khẩu proxy vào file được commit.

Luồng kiểm tra: tải cấu hình JSON `application-config` trong trang đăng ký, lấy token
và mã phiên, rồi gọi `POST https://register-suggest.mail.com/rest/email-alias/availability`.
Chỉ chấp nhận HTTP 200 có `requestedEmailAddress` khớp email gửi đi và
`emailAddressAvailable` là boolean. HTTP 409/403, HTML xác minh hoặc phản hồi sai định
dạng đều là chưa xác định. Không dùng endpoint tạo tài khoản, gửi SMS hoặc đăng nhập.
Các tên miền như `mail.com`, `email.com`, `usa.com`, `post.com` được hỗ trợ nếu xuất
hiện trong cấu hình đăng ký hiện tại. Không áp dụng cho địa chỉ Proton.

## Cấu trúc

```text
src/
  main.js             # Cửa sổ Electron, IPC, chọn file/thư mục
  preload.js          # API giới hạn giữa giao diện và main process
  batch.js            # Hàng đợi, tạm dừng/tiếp tục, lưu kết quả
  services/
    mailcom.js        # Cấu hình đăng ký, token và kiểm tra tên qua API mail.com
    proxy.js          # Chuẩn hóa cấu hình proxy
  ui/                 # HTML, CSS, renderer
test/                 # Kiểm thử không dùng mạng
data/                 # File mẫu và dữ liệu đầu vào cục bộ
test.js               # Kiểm tra một email thật
```

Tham chiếu: [trang đăng ký](https://signup.mail.com/) và
[danh sách domain](https://www.mail.com/mail/domains/).
Đối chiếu luồng request trong JavaScript `@mamdev/umreg.registration-app2` phiên bản
8.38.0 ngày 2026-10-14; đây là API của trang đăng ký và có thể thay đổi.
