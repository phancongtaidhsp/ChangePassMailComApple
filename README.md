# Proton Email Checker

Ứng dụng Electron kiểm tra email qua API đăng ký Proton. Không cần mật khẩu,
không đăng nhập vào hộp thư, không tạo tài khoản hoặc gửi email.

## Chạy ứng dụng

Dùng Node.js 18 trở lên (khuyến nghị bản LTS còn được hỗ trợ).

```sh
npm install
npm start
```

1. Chọn file TXT, mỗi dòng một địa chỉ Proton. Xem `data/emails.example.txt`.
2. Có thể chọn file proxy HTTP/HTTPS, mỗi dòng một proxy; để trống để kết nối trực tiếp.
3. Chọn thư mục kết quả, số luồng (1–200) và thời gian nghỉ giữa hai email trên mỗi luồng (tối thiểu 1 giây).
4. Bắt đầu kiểm tra. Tạm dừng sẽ chờ các yêu cầu đang chạy hoàn tất và lưu kết quả.
5. Tiếp tục để xử lý phần còn lại trong cùng lượt; “Lượt kiểm tra mới” tạo thư mục mới.

Dòng trống và địa chỉ trùng (không phân biệt chữ hoa/thường) được bỏ qua.
File cũ dạng `email|password|recoveryEmail` được chấp nhận: chỉ lấy email đầu dòng,
không lưu các trường còn lại. File đầu vào không bị sửa. Alias `+tag` và tên miền riêng
không được hỗ trợ; chúng được ghi vào nhóm chưa xác định.

Proxy hỗ trợ `host:port`, `host:port:user:password`, `user:password:host:port`
và `http://user:password@host:port`. Mỗi luồng dùng cố định một proxy trong lượt đó.
Không tự đổi proxy hoặc gửi lại yêu cầu khi gặp giới hạn/xác minh.
Riêng lỗi kết nối hoặc quá thời gian chờ API được thử lại tối đa 3 lần sau lần gọi
đầu tiên (tối đa 4 lần kiểm tra), nghỉ 1 giây giữa các lần. Ngân sách thử lại dùng
chung cho bước tạo phiên và kiểm tra email. Chỉ kết quả cuối cùng được lưu và tính
vào bộ đếm; nếu vẫn lỗi thì email vào `unknown.txt`.

## Ý nghĩa kết quả

| Nhóm | File | Ý nghĩa |
| --- | --- | --- |
| Còn đăng ký được | `available.txt` | API cho phép đăng ký tên này |
| Không khả dụng | `unavailable.txt` | Tên đã dùng hoặc bị giữ lại; chưa xác nhận hộp thư đang tồn tại |
| Chưa xác định | `unknown.txt` | Email không hợp lệ, lỗi mạng/API, giới hạn hoặc xác minh |
| Chưa kiểm tra | `pending.txt` | Chưa hoàn tất kiểm tra trong lượt này |

Đây không phải phép kiểm chứng live/die tuyệt đối. API đăng ký không xác nhận khả năng
nhận thư hay trạng thái hoạt động của tài khoản. Vì thế ứng dụng không xuất `live.txt`
hoặc `die.txt` với khẳng định vượt quá dữ liệu API.

Mặc định lưu trong `Documents/ProtonEmailChecker/results/<thời-gian>-<mã-lượt>/`.
Thư mục mỗi lượt chỉ có file TXT. `results.txt` chứa kết quả chi tiết, mỗi dòng dạng
`email|nhóm|thông báo|HTTP status|mã API|mã lỗi mạng|số lần thử lại|thời điểm`;
`summary.txt` chứa thống kê dạng văn bản dễ đọc.
`results.txt` được ghi sau mỗi email; các file phân loại và tổng kết được cập nhật
khi tạm dừng, hoàn tất hoặc đóng ứng dụng bình thường. Không lưu token phiên hoặc
mật khẩu proxy. Nếu ứng dụng bị đóng đột ngột, `results.txt` là nhật ký mới nhất;
các file phân loại có thể chưa cập nhật.

Tiếp tục trong cùng phiên ứng dụng dùng danh sách đã nạp, kể cả khi người dùng đổi file
trên giao diện. Sau khi mở lại ứng dụng, chọn `pending.txt` của lượt trước để chạy tiếp
trong lượt mới; muốn kiểm tra lại lỗi thì chọn `unknown.txt`.
Khi gặp HTTP 429, yêu cầu xác minh hoặc phiên bản API không được hỗ trợ, ứng dụng tạm
dừng toàn bộ lượt. Xem chi tiết lỗi/Retry-After trước khi tiếp tục; email đã nhận lỗi
nằm trong `unknown.txt` và không tự kiểm tra lại.

## Kiểm thử và đóng gói

```sh
npm test              # Kiểm thử giả lập, không gọi Proton
npm run test:ui       # Mở Electron kiểm thử giao diện với dữ liệu giả
npm run check:email   # Gọi Proton thật với email trong test.js
npm run package       # Đóng gói ứng dụng cho máy hiện tại
npm run make          # Tạo bộ cài theo cấu hình Electron Forge
```

Sửa email/proxy trong `test.js` để kiểm tra riêng một email. Khi Proton đổi phiên bản
web, có thể ghi đè `appVersion` trong tham số thứ ba của `ProtonMailClass`.

## Cấu trúc

```text
src/
  main.js             # Cửa sổ Electron, IPC, chọn file/thư mục
  preload.js          # API giới hạn giữa giao diện và main process
  batch.js            # Hàng đợi, tạm dừng/tiếp tục, lưu kết quả
  services/
    protonmail.js     # Phiên khách và kiểm tra tên qua API Proton
    proxy.js          # Chuẩn hóa cấu hình proxy
  ui/                 # HTML, CSS, renderer
test/                 # Kiểm thử không dùng mạng
data/                 # File mẫu và dữ liệu đầu vào cục bộ
test.js               # Kiểm tra một email thật
```

Tham chiếu API: [user.ts](https://github.com/ProtonMail/WebClients/blob/main/packages/shared/lib/api/user.ts)
và [auth.ts](https://github.com/ProtonMail/WebClients/blob/main/packages/shared/lib/api/auth.ts).
