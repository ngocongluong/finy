# Finy

Trợ lý tài chính cá nhân chạy trên Android (Expo / React Native), giao diện tối, dữ liệu mã hoá trên máy, dùng Claude để tư vấn và tự chỉnh giao diện.

App dành cho **một người dùng**: không có máy chủ, không có tài khoản. Mọi dữ liệu nằm trên điện thoại.

## Tính năng

| Tab | Làm được gì |
|---|---|
| **Tổng quan** | Thẻ tín dụng (kỳ này, và từ ngày 15 thêm kỳ trước đã chốt sổ), tóm tắt tháng (Thu, Chi, Để dành được, Chi/Thu), khoản chi lớn nhất (thẻ tín dụng tính theo thực chi), giao dịch gần đây, dự phóng dài hạn. Nút con mắt để hiện số tiền. |
| **Ngân sách** | Nhập nguồn thu cố định và khoản chi cố định hàng tháng; Finy lập bảng thu / chi / để dành cho 6, 12 hoặc 24 tháng tới. Chạm một tháng để mở chi tiết: mục **Thu** và mục **Chi** tách riêng, sửa được từng dòng cho riêng tháng đó, thêm khoản phát sinh, và phần **Chi tín dụng** của kỳ sao kê. Kèm danh sách tài khoản tạo nên tổng tiền hiện có. |
| **Giao dịch** | Nhập chi tiêu hằng ngày; đồng bộ giao dịch thẻ tín dụng HSBC từ Gmail (tự chạy mỗi lần mở app). |
| **Kế hoạch** | Dự phóng tài sản ròng 5–10 năm theo 3 kịch bản, khoản vay, các khoản chi lớn, bảng từng năm. |
| **Finy** | Trò chuyện với Claude: tư vấn dựa trên số liệu thật và sửa mọi con số trong app theo lời bạn ("tháng 12 lương 60 triệu", "thêm học phí 30 triệu vào tháng 1 và 6", "dự chi tín dụng còn 30 triệu", "sửa giao dịch cà phê thành 80k"), kể cả giao diện ("đổi sang tông xanh lá", "ẩn khối kế hoạch"). |

### Cách tính

- **Thu của một tháng** = tổng thu cố định + thu phát sinh của tháng đó. **Chi** = tổng chi cố định (gồm trả nợ) + chi phát sinh của tháng đó.
- **Để dành được** = thu − chi. Bạn không nhập số để dành; Finy tính ra. Số âm nghĩa là tháng đó thiếu hụt.
- **Chi/Thu** = chi / thu của tháng.
- Khoản lặp lại mọi tháng là **cố định**; khoản chỉ có ở vài tháng (thưởng Tết, học phí theo kỳ, sửa xe) là **phát sinh**, khi thêm có thể chọn nhiều tháng cùng lúc. Một khoản cố định có thể mang **số tiền riêng cho một tháng** (kể cả 0) mà không ảnh hưởng các tháng khác.
- **Thẻ tín dụng**: một khoản chi cố định được đánh dấu "Tín dụng" là *dự chi* mỗi kỳ sao kê. Kỳ sao kê chốt vào ngày sao kê (mặc định 14, đổi trong Cài đặt) và được trả bằng lương của tháng có ngày chốt đó: kỳ 15/11–14/12 thuộc tháng 12. *Đã xài* = tổng giao dịch thẻ trong kỳ (trừ hoàn tiền). Khi kỳ còn mở, chi của tháng tính theo dự chi (hoặc số đã xài nếu nhiều hơn); khi kỳ đã chốt, số đã xài thực tế thay cho dự chi. Tổng quan hiện kỳ hiện tại, và từ ngày 15 hiện thêm kỳ vừa chốt; chạm vào để xem toàn bộ giao dịch của kỳ (kèm giờ:phút:giây). Khi đã xài vượt dự chi, Finy cảnh báo ở Tổng quan và bật thông báo sau khi đồng bộ. Giao dịch ngoại tệ được quy ra VND từ chênh lệch dư nợ giữa hai email liên tiếp (không được thì ước tính theo tỷ giá, ghi rõ "ước tính"). Khoản trả qua thẻ mà HSBC không gửi email (như trả góp) nhập thành khoản chi cố định có bật "Trả qua thẻ tín dụng"; khoản này được cộng vào mỗi kỳ. Hoàn tiền cashback không có email nên không được tính.
- **Trả góp qua thẻ**: ở Ngân sách → Cố định, mục Trả góp qua thẻ, thêm khoản trả góp với tổng tiền, số tháng và kỳ sao kê trả phần đầu (chọn được kỳ đã qua cho khoản đang trả dở). App chia đều (phần lẻ dồn vào kỳ cuối), cộng một phần vào chi tín dụng của mỗi kỳ, và tự dừng sau kỳ cuối.
- Mọi số tiền được ẩn mỗi lần mở app. Mỗi mục có con mắt riêng ở góc trên bên phải; màn danh sách (Giao dịch, trò chuyện Finy) có một con mắt ở đầu màn hình. Khoá app thì tất cả ẩn lại. Giao dịch thẻ không tính vào quỹ chi tiêu hằng ngày.
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
- Email HSBC: chỉ email có người gửi thuộc `hsbc.com.vn` / `hsbc.com` / `hsbc.com.hk` mới được đọc (HSBC Việt Nam gửi báo giao dịch thẻ từ `notification.hsbc.com.hk`). Email báo giao dịch thẻ tín dụng (định dạng cố định) được đọc ngay trên máy, không gửi đi đâu. Chỉ email HSBC có định dạng khác mới được gửi tới API của Anthropic để tách số tiền, nơi giao dịch.
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

Google yêu cầu mỗi app phải có một *OAuth client* gắn với package và chữ ký của APK trước khi được đọc Gmail. Google không có API để tạo phần này, nên có vài cú bấm phải làm tay trên trình duyệt (đăng nhập bằng chính tài khoản Gmail nhận thư HSBC).

Cách ngắn nhất là qua Firebase, vì Firebase tự tạo OAuth client và màn hình đồng ý:

1. Chọn (hoặc tạo) một project trên [Firebase Console](https://console.firebase.google.com/). Trong *Project settings* thêm app Android với package `com.finy.app` và **SHA-1** mà `npm run apk` in ra. Bật **Gmail API** cho project đó trong [Google Cloud Console](https://console.cloud.google.com/apis/library/gmail.googleapis.com).
2. Vào **Authentication → Sign-in method → Google → Enable**, chọn email hỗ trợ, **Save**. Bước này khiến Google tạo OAuth client cho app.
3. Trên điện thoại: **Cài đặt → Kết nối Gmail**, chọn tài khoản và đồng ý cho Finy đọc thư. App sẽ lấy giao dịch HSBC ngay sau đó, và tự đồng bộ lại mỗi lần mở app.

Có thể mở thẳng màn đăng nhập từ máy tính: `adb shell am start -a android.intent.action.VIEW -d "finy://settings?gmail=connect" com.finy.app` (app sẽ hỏi PIN trước).

Ghi chú:

- Vì app chưa được Google xác minh, màn đăng nhập hiện cảnh báo "Google hasn't verified this app": bấm **Advanced → Go to … (unsafe)** để tiếp tục. Đây là app của chính bạn, chỉ xin quyền *đọc* thư.
- Nếu Google báo "Access blocked … has not completed the Google verification process", màn hình đồng ý đang ở chế độ *Testing*: vào [Google Auth Platform → Audience](https://console.cloud.google.com/auth/audience) của project, thêm địa chỉ Gmail của bạn vào **Test users** (hoặc bấm **Publish app**). Ở chế độ Testing, Google bắt cấp quyền lại mỗi 7 ngày.
- Lỗi `DEVELOPER_ERROR` trong app nghĩa là chưa có OAuth client khớp package + SHA-1 của APK đang cài (chưa làm bước 2, hoặc APK được ký bằng keystore khác).
- Bộ lọc email mặc định là `from:HSBC@notification.hsbc.com.hk newer_than:60d` (địa chỉ HSBC Việt Nam gửi báo giao dịch thẻ), sửa được trong Cài đặt. App chỉ đọc thư từ đúng tên miền HSBC; kết quả mỗi lần đồng bộ hiện ở tab Giao dịch.

## Finy tự chỉnh giao diện như thế nào

Toàn bộ giao diện được sinh từ một cấu hình duy nhất (`UiConfig` trong [src/lib/types.ts](src/lib/types.ts)): bảng màu, độ bo góc, cỡ chữ, mật độ, cách hiện số tiền, tên app, thứ tự và ẩn/hiện các khối ở Tổng quan, và các thẻ tuỳ biến. Claude sửa cấu hình này qua công cụ `update_ui`. App từ chối bảng màu thiếu tương phản (chữ khó đọc) và báo lại để Claude chọn màu khác. Mọi thay đổi đều hoàn tác được (nút hoàn tác ở tab Finy hoặc trong Cài đặt). Màn hình khoá luôn dùng giao diện gốc.

Những gì nằm ngoài cấu hình (thêm màn hình mới, đổi bố cục bên trong một khối) cần sửa code.

## Cấu trúc mã nguồn

```
src/app/            màn hình (Expo Router): 5 tab + month/[month] (chi tiết tháng) + settings
src/components/     ui.tsx (khối giao diện theo theme), charts.tsx, sheets.tsx, LockScreen.tsx
src/lib/
  store.ts          trạng thái toàn app, ghi xuống DB mã hoá
  db.ts             SQLite + SQLCipher
  security.ts       PIN, vân tay, khoá DB
  finance.ts        bảng thu chi theo tháng, kỳ sao kê tín dụng, hạn mức ngày (thuần, có test)
  plan.ts           dự phóng 5–10 năm                    (thuần, có test)
  theme.ts          cấu hình giao diện + kiểm tra tương phản (thuần, có test)
  claude.ts         Claude: tư vấn + công cụ sửa dữ liệu / giao diện
  gmail.ts, hsbc.ts đọc Gmail, nhập giao dịch HSBC
  mailText.ts       đọc email thẻ tín dụng HSBC ngay trên máy  (thuần, có test)
plugins/            config plugin ký APK bằng keystore riêng
tests/              npm test
```

```bash
npm test            # test phần tính toán
npm run typecheck
```
