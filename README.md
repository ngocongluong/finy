# Finy

Trợ lý tài chính cá nhân chạy trên Android (Expo / React Native), giao diện tối, dữ liệu mã hoá trên máy, dùng Claude để tư vấn và tự chỉnh giao diện.

App dành cho **một người dùng**: không có máy chủ, không có tài khoản. Mọi dữ liệu nằm trên điện thoại.

## Tính năng

| Tab | Làm được gì |
|---|---|
| **Tổng quan** | Hôm nay còn tiêu được bao nhiêu, chi tiêu 14 ngày, tóm tắt tháng (Thu, Chi, Để dành được, Chi/Thu), tổng tiền hiện có, dự phóng dài hạn. Nút con mắt để ẩn mọi số tiền. |
| **Ngân sách** | Nhập nguồn thu cố định và khoản chi cố định hàng tháng, thêm các khoản thu / chi phát sinh cho những tháng tự chọn; Finy lập bảng thu / chi / để dành cho 6, 12 hoặc 24 tháng tới. Kèm danh sách tài khoản tạo nên tổng tiền hiện có. |
| **Giao dịch** | Nhập chi tiêu hằng ngày; đồng bộ giao dịch HSBC từ Gmail. |
| **Kế hoạch** | Dự phóng tài sản ròng 5–10 năm theo 3 kịch bản, khoản vay, các khoản chi lớn, bảng từng năm. |
| **Finy** | Trò chuyện với Claude: tư vấn dựa trên số liệu thật, ghi chép giúp, và đổi giao diện theo góp ý ("đổi sang tông xanh lá", "ẩn khối kế hoạch", "thêm thẻ tỷ lệ để dành"…). |

### Cách tính

- **Thu của một tháng** = tổng thu cố định + thu phát sinh của tháng đó. **Chi** = tổng chi cố định (gồm trả nợ) + chi phát sinh của tháng đó.
- **Để dành được** = thu − chi. Bạn không nhập số để dành; Finy tính ra. Số âm nghĩa là tháng đó thiếu hụt.
- **Chi/Thu** = chi / thu của tháng.
- Khoản lặp lại mọi tháng là **cố định**; khoản chỉ có ở vài tháng (thưởng Tết, học phí theo kỳ, sửa xe) là **phát sinh**, khi thêm có thể chọn nhiều tháng cùng lúc.
- **Hạn mức hôm nay** = (quỹ chi tiêu hằng ngày − đã tiêu các ngày trước trong tháng) / số ngày còn lại. Quỹ là khoản chi cố định được bật "quỹ chi tiêu hằng ngày".
- **Kế hoạch**: mô phỏng theo tháng từ thu chi cố định và các khoản phát sinh đã nhập; thu nhập tăng theo %/năm, chi tiêu tăng theo lạm phát, tiền để dành sinh lãi. Khoản vay có nhập dư nợ sẽ được trả dần và giải phóng dòng tiền khi hết nợ; khoản chưa nhập dư nợ được coi là trả suốt kế hoạch.

## Bảo mật

- Khoá bằng **mã PIN 6 số** và **vân tay**; sai 5 lần thì tạm khoá, thời gian chờ tăng gấp đôi mỗi lần sai tiếp.
- Tự khoá khi rời app (ngay lập tức, 30 giây hoặc 2 phút).
- **Chặn chụp/quay màn hình** và ẩn nội dung ở màn hình đa nhiệm (`FLAG_SECURE`).
- Cơ sở dữ liệu mã hoá bằng **SQLCipher**; khoá 256-bit nằm trong Android Keystore. Tắt sao lưu Android (`allowBackup=false`).
- Nút ẩn số tiền để tránh bị nhìn lén.

Những gì rời khỏi máy:

- Câu hỏi trong tab Finy kèm bản tóm tắt tài chính hiện tại → gửi tới API của Anthropic.
- Nội dung email HSBC khi đồng bộ → gửi tới API của Anthropic để tách số tiền, nơi giao dịch. Chỉ email có người gửi thuộc `hsbc.com.vn` / `hsbc.com` mới được đọc.
- Yêu cầu đọc thư → gửi tới Gmail API (quyền chỉ-đọc).

**API key của Claude nằm trong file APK.** Ai có file APK đều lấy được key, nên đừng chia sẻ APK. Key không nằm trong repo này.

## Build và cài lên điện thoại

Cần Node 20+, JDK 17, Android SDK.

```bash
npm install
echo "sk-ant-..." > .credentials          # API key của Claude (đã gitignore)
cp seed.example.json secrets/seed.json     # tuỳ chọn: dữ liệu ban đầu (đã gitignore)
npm run apk                                # tạo dist/finy.apk
adb install -r dist/finy.apk               # bật USB debugging trên máy trước
```

`npm run apk` tạo keystore ký riêng ở `secrets/finy.keystore` trong lần chạy đầu và in ra **SHA-1** của chứng chỉ (cần cho bước Gmail bên dưới). Giữ lại thư mục `secrets/`: mất keystore thì không cập nhật đè lên bản đã cài được.

Mặc định chỉ build cho `arm64-v8a` (Galaxy S23 và mọi máy đời mới). Build thêm kiến trúc khác: `FINY_ARCHS=arm64-v8a,x86_64 npm run apk`.

Các file **không bao giờ được commit** (đã có trong `.gitignore`): `.credentials`, `secrets/`, `android/`, `dist/`.

## Kết nối Gmail (làm một lần)

Google yêu cầu mỗi app phải được đăng ký trước khi đọc Gmail. Làm trên [Google Cloud Console](https://console.cloud.google.com/), đăng nhập bằng chính tài khoản Gmail nhận thư HSBC:

1. Tạo một project mới.
2. **APIs & Services → Library** → bật **Gmail API**.
3. **OAuth consent screen**: loại *External*, điền tên app và email. Ở phần *Audience* thêm địa chỉ Gmail của bạn vào **Test users**. Ở phần *Data access* thêm scope `https://www.googleapis.com/auth/gmail.readonly`.
4. **Credentials → Create credentials → OAuth client ID → Android**: package name `com.finy.app`, SHA-1 là dòng `npm run apk` đã in ra.
5. Mở app → **Cài đặt → Kết nối Gmail**, chọn tài khoản và đồng ý cấp quyền đọc thư. Sau đó vào tab **Giao dịch → Đồng bộ giao dịch HSBC**.

Ghi chú:

- Khi consent screen ở chế độ *Testing*, Google bắt cấp quyền lại sau mỗi 7 ngày. Bấm **Publish app** để bỏ giới hạn này (app chưa xác minh vẫn dùng được cho chính bạn, chỉ hiện thêm một màn hình cảnh báo).
- Lỗi `DEVELOPER_ERROR` khi kết nối nghĩa là package name hoặc SHA-1 ở bước 4 chưa khớp với APK đang cài.
- Bộ lọc email mặc định là `from:(hsbc.com.vn OR hsbc.com) newer_than:45d`, sửa được trong Cài đặt.

## Finy tự chỉnh giao diện như thế nào

Toàn bộ giao diện được sinh từ một cấu hình duy nhất (`UiConfig` trong [src/lib/types.ts](src/lib/types.ts)): bảng màu, độ bo góc, cỡ chữ, mật độ, cách hiện số tiền, tên app, thứ tự và ẩn/hiện các khối ở Tổng quan, và các thẻ tuỳ biến. Claude sửa cấu hình này qua công cụ `update_ui`. App từ chối bảng màu thiếu tương phản (chữ khó đọc) và báo lại để Claude chọn màu khác. Mọi thay đổi đều hoàn tác được (nút hoàn tác ở tab Finy hoặc trong Cài đặt). Màn hình khoá luôn dùng giao diện gốc.

Những gì nằm ngoài cấu hình (thêm màn hình mới, đổi bố cục bên trong một khối) cần sửa code.

## Cấu trúc mã nguồn

```
src/app/            màn hình (Expo Router): 5 tab + settings
src/components/     ui.tsx (khối giao diện theo theme), charts.tsx, sheets.tsx, LockScreen.tsx
src/lib/
  store.ts          trạng thái toàn app, ghi xuống DB mã hoá
  db.ts             SQLite + SQLCipher
  security.ts       PIN, vân tay, khoá DB
  finance.ts        bảng thu chi theo tháng, hạn mức ngày (thuần, có test)
  plan.ts           dự phóng 5–10 năm                    (thuần, có test)
  theme.ts          cấu hình giao diện + kiểm tra tương phản (thuần, có test)
  claude.ts         Claude: tư vấn + công cụ sửa dữ liệu / giao diện
  gmail.ts, hsbc.ts đọc Gmail, tách giao dịch HSBC bằng Claude
plugins/            config plugin ký APK bằng keystore riêng
tests/              npm test
```

```bash
npm test            # test phần tính toán
npm run typecheck
```
