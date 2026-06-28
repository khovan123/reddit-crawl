# Local Reddit Crawl

Backend NestJS + WebExtension chạy hoàn toàn trên máy local. Extension hỗ trợ Google Chrome/Chromium và Firefox, đọc session của tab Reddit hiện tại, gửi session tới backend trên `127.0.0.1`, sau đó Playwright mở một browser context riêng để tự cuộn các feed theo quota và xuất JSON ở root project.

## Dữ liệu xuất ra

Mỗi job tạo hai file tại root backend:

- `reddit-crawl-<jobId>.json`: kết quả riêng của job.
- `reddit-crawl-result.json`: kết quả mới nhất.

Dữ liệu gồm author, subreddit, title, content, summary dạng excerpt, media/image, score, `likeCount: null`, vote state nếu có, comment count, top comments tùy cấu hình, flags và placement theo từng nguồn.

`score` của Reddit không phải tổng lượt like nên `likeCount` luôn để `null` thay vì gán sai bằng score.

## Yêu cầu

- Node.js 20+
- Google Chrome/Chromium hoặc Firefox 121+
- Đã đăng nhập Reddit trên trình duyệt sẽ dùng extension

## Cài backend

```bash
npm install
npx playwright install chromium
cp .env.example .env
npm run start:dev
```

Backend chỉ bind tại:

```text
http://127.0.0.1:47831
```

Kiểm tra:

```bash
curl http://127.0.0.1:47831/api/reddit/health
```

### Browser mà Playwright dùng

Mặc định `.env.example` đặt:

```env
REDDIT_BROWSER_CHANNEL=chrome
```

Thiết lập này chỉ quyết định browser do backend Playwright khởi chạy. Extension có thể lấy session từ Chrome hoặc Firefox; snapshot cookie, user-agent, locale, timezone và viewport sẽ được đưa vào Playwright context.

Muốn dùng Chromium do Playwright cài, để biến này rỗng:

```env
REDDIT_BROWSER_CHANNEL=
```

## Cài extension trên Chrome/Chromium

1. Mở `chrome://extensions`.
2. Bật **Developer mode**.
3. Chọn **Load unpacked**.
4. Chọn thư mục `extension/` trong repo.
5. Mở `https://www.reddit.com/` và đăng nhập.
6. Mở extension, cấu hình nguồn và số bài.
7. Nhấn **Bắt đầu quét**.

## Cài extension trên Firefox

Firefox dùng cùng thư mục `extension/` và cùng `manifest.json` với Chrome.

1. Mở Firefox 121 trở lên.
2. Nhập `about:debugging` trên thanh địa chỉ.
3. Chọn **This Firefox**.
4. Chọn **Load Temporary Add-on**.
5. Chọn file `extension/manifest.json`.
6. Mở `https://www.reddit.com/` trong Firefox và đăng nhập.
7. Mở Reddit Crawl trên toolbar, cho phép quyền truy cập Reddit/localhost khi Firefox yêu cầu.
8. Nhấn **Kết nối lại** hoặc **Bắt đầu quét**.

Temporary Add-on sẽ bị gỡ khi Firefox đóng hoàn toàn. Khi phát hành chính thức cần đóng gói và ký qua Mozilla Add-ons; manifest đã có Gecko extension ID và khai báo dữ liệu cần thiết cho quy trình ký Manifest V3.

## Tương thích Chrome và Firefox

Manifest V3 khai báo đồng thời:

```json
{
  "background": {
    "scripts": ["browser-compat.js", "background.js"],
    "service_worker": "background.js"
  }
}
```

- Chrome dùng `background.service_worker`.
- Firefox dùng `background.scripts`/event page.
- `browser-compat.js` ánh xạ API Promise của Firefox (`browser.*`) sang namespace mà code hiện tại sử dụng.
- Cookie store được xác định theo tab Reddit active, nên Firefox Multi-Account Containers và Chrome profile/incognito không bị trộn session nếu browser trả về đúng store của tab.

## Nguồn hỗ trợ

- Home
- Popular
- News
- Best
- Following
- Latest
- Nhiều subreddit, mỗi subreddit có sort và quota riêng
- Nhiều URL Reddit tùy chỉnh, mỗi URL có quota riêng

Với Following, worker mở Home rồi tìm tab/link/button tương ứng vì URL có thể khác giữa các layout Reddit.

## API

### Gửi browser session

Extension gọi:

```http
POST /api/reddit/session
```

Session chỉ nằm trong memory của backend, không được ghi vào file kết quả.

### Tạo crawl job

```http
POST /api/reddit/crawl
Content-Type: application/json

{
  "sources": [
    {
      "id": "home",
      "type": "HOME",
      "targetPostCount": 50
    },
    {
      "id": "smallbusiness",
      "type": "SUBREDDIT",
      "subreddit": "smallbusiness",
      "sort": "NEW",
      "targetPostCount": 100
    }
  ],
  "detail": {
    "enabled": true,
    "maxParallelTabs": 2,
    "commentsTopN": 5
  }
}
```

### Xem trạng thái

```http
GET /api/reddit/crawl/<jobId>
```

## Cơ chế crawl

1. Extension lấy cookie store của tab Reddit active.
2. Extension gửi cookie, localStorage, user-agent, locale, timezone và viewport tới backend local.
3. Backend tạo Playwright context mới và nạp snapshot session.
4. Mở từng source tuần tự.
5. Parse post card và permalink đang render.
6. Dedupe bằng `t3_<postId>` hoặc ID trong permalink.
7. Cuộn, bấm load-more, retry và reload một lần khi feed bị stall.
8. Dừng khi đủ quota hoặc đã dùng hết giới hạn phục hồi.
9. Mở tối đa số detail tabs được cấu hình để lấy full body, media và comments.
10. Gộp post canonical với placements của từng source.
11. Ghi JSON tại root.

## Lưu ý vận hành

- Chỉ một crawl job chạy tại một thời điểm.
- Không commit các file `reddit-crawl-*.json` vì đã có trong `.gitignore`.
- Session và job nằm trong RAM, sẽ mất khi backend restart.
- Extension chỉ kết nối tới backend local tại `127.0.0.1:47831`.
- Firefox cần cho phép host permission Reddit và localhost.
- Khi Reddit đổi DOM, cập nhật parser/scroll strategy trong `src/reddit/`.
- Chạy headful (`REDDIT_HEADLESS=false`) sẽ dễ quan sát và ổn định hơn với feed cá nhân hóa.
