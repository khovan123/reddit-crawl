# Local Reddit Crawl

Backend NestJS + Chrome extension chạy hoàn toàn trên máy local. Extension đọc session của tab Reddit hiện tại, gửi session tới backend trên `127.0.0.1`, sau đó Playwright mở một browser context riêng để tự cuộn các feed theo quota và xuất JSON ở root project.

## Dữ liệu xuất ra

Mỗi job tạo hai file tại root backend:

- `reddit-crawl-<jobId>.json`: kết quả riêng của job.
- `reddit-crawl-result.json`: kết quả mới nhất.

Dữ liệu gồm author, subreddit, title, content, summary dạng excerpt, media/image, score, `likeCount: null`, vote state nếu có, comment count, top comments tùy cấu hình, flags và placement theo từng nguồn.

`score` của Reddit không phải tổng lượt like nên `likeCount` luôn để `null` thay vì gán sai bằng score.

## Yêu cầu

- Node.js 20+
- Google Chrome hoặc Chromium
- Đã đăng nhập Reddit trên Chrome

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

### Dùng Chrome hệ thống

Mặc định `.env.example` đặt:

```env
REDDIT_BROWSER_CHANNEL=chrome
```

Khi đó Playwright dùng Chrome hệ thống. Nếu muốn dùng Chromium do Playwright cài, để biến này rỗng:

```env
REDDIT_BROWSER_CHANNEL=
```

## Cài extension

1. Mở `chrome://extensions`.
2. Bật **Developer mode**.
3. Chọn **Load unpacked**.
4. Chọn thư mục `extension/` trong repo.
5. Mở `https://www.reddit.com/` và đăng nhập.
6. Mở extension, cấu hình từng nguồn và số bài.
7. Nhấn **Bắt đầu quét**.

Extension hỗ trợ:

- Home
- For You
- Following
- Popular
- Latest
- Subreddit với sort
- URL Reddit tùy chỉnh

Với For You/Following, worker mở Home rồi tìm tab/link/button tương ứng vì URL có thể khác giữa các layout Reddit.

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

1. Tạo Playwright context mới.
2. Nạp cookie, user-agent, locale, timezone và localStorage từ Chrome hiện tại.
3. Mở từng source tuần tự.
4. Parse post card đang render.
5. Dedupe bằng `t3_<postId>` hoặc ID trong permalink.
6. Cuộn đến card cuối và chờ DOM tải thêm.
7. Dừng khi đủ quota, hết số vòng cuộn hoặc feed bị stall.
8. Mở tối đa 1–4 detail tabs song song để lấy full body, media và comments.
9. Gộp post canonical với placements của từng source.
10. Ghi JSON tại root.

## Lưu ý vận hành

- Chỉ một crawl job chạy tại một thời điểm.
- Không commit các file `reddit-crawl-*.json` vì đã có trong `.gitignore`.
- Session không được persist và sẽ mất khi backend restart.
- Khi Reddit đổi DOM, cập nhật selector trong `src/reddit/reddit-crawler.service.ts`.
- Chạy headful (`REDDIT_HEADLESS=false`) sẽ dễ quan sát và ổn định hơn với feed cá nhân hóa.
