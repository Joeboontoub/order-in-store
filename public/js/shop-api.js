// เรียก API ของร้าน (Cloudflare Worker ในโฟลเดอร์ worker/) ซึ่งเก็บ token Telegram ไว้ฝั่งเซิร์ฟเวอร์
// Calls the shop API (Cloudflare Worker in worker/) that keeps the Telegram token server-side.
const SHOP_API_URL = window.SHOP_API_URL || "https://faa-shop-api.WORKERS_SUBDOMAIN.workers.dev";

async function shopApi(path, body) {
  const res = await fetch(SHOP_API_URL + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
  return data;
}

// แจ้งร้านทาง Telegram ว่ามีออร์เดอร์ใหม่ (Worker อ่านรายละเอียดจาก Firestore เอง ไม่เชื่อข้อมูลจากหน้าเว็บ)
function notifyNewOrder(orderId) {
  return shopApi("/api/notify-order", { orderId });
}

// ลูกค้าดูบิลของตัวเองด้วยเบอร์โทร (ชื่อ/เบอร์ในผลลัพธ์ถูกปิดบางส่วน)
async function findMyOrders(phone) {
  return (await shopApi("/api/my-orders", { phone })).orders;
}
