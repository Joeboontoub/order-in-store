// Faa Homemade shop API (Cloudflare Worker)
//
// ทำไมต้องมี Worker: หน้าเว็บเป็นไฟล์ static ใครก็เปิดดูโค้ดได้ ถ้าใส่ token ของ Telegram ไว้ในหน้าเว็บ token จะหลุด
// Worker เป็นโค้ดฝั่งเซิร์ฟเวอร์ (ฟรี ไม่ต้องใช้บัตร) จึงเก็บความลับได้ และเป็นตัวกลางที่อ่าน Firestore ด้วยบัญชี "บอท"
// ที่มีสิทธิ์จำกัด (อ่านออร์เดอร์ + ทำเครื่องหมายว่าแจ้งเตือนแล้วเท่านั้น)
//
// Why: the site is static, so any secret in it is public. This Worker keeps the Telegram token secret and
// reads Firestore as a least-privilege "bot" account (read orders, mark them notified — nothing else).
//
// Endpoints
//   POST /api/notify-order   { orderId }  -> sends the Telegram alert for a new order (once per order)
//   POST /api/my-orders      { phone }    -> a customer's recent orders, with personal data masked

const NOTIFY_WINDOW_MS = 10 * 60 * 1000; // แจ้งเตือนได้เฉพาะออร์เดอร์ที่เพิ่งสร้างไม่เกิน 10 นาที
const MAX_LOOKUP_RESULTS = 10;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    if (!cors) return json({ error: "origin not allowed" }, 403);

    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/api/notify-order") return json(await notifyOrder(request, env), 200, cors);
      if (request.method === "POST" && url.pathname === "/api/my-orders") return json(await myOrders(request, env), 200, cors);
      return json({ error: "not found" }, 404, cors);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      return json({ error: status === 500 ? "internal error" : err.message }, status, cors);
    }
  },
};

// ---------- endpoints ----------

async function notifyOrder(request, env) {
  const { orderId } = await readJson(request);
  if (typeof orderId !== "string" || !/^[A-Za-z0-9]{10,40}$/.test(orderId)) throw new HttpError(400, "invalid orderId");

  const token = await botToken(env);
  const doc = await firestore(env, token, "GET", `orders/${orderId}`);
  if (!doc) throw new HttpError(404, "order not found");

  const order = fromFirestore(doc.fields);
  if (order.notified === true) return { sent: false, reason: "already notified" };
  const createdAt = order.timestamp ? new Date(order.timestamp).getTime() : 0;
  if (Date.now() - createdAt > NOTIFY_WINDOW_MS) throw new HttpError(409, "order too old to notify");

  // ทำเครื่องหมายก่อนส่ง: กฎ Firestore ยอมให้ติ๊ก notified ได้ครั้งเดียว ถ้ามีคำขอพร้อมกัน คำขอที่สองจะถูกปฏิเสธ จึงไม่ส่งซ้ำ
  // Mark first. The rules allow notified=true only once, so a concurrent second call is rejected and sends nothing.
  const marked = await firestore(env, token, "PATCH",
    `orders/${orderId}?updateMask.fieldPaths=notified&currentDocument.exists=true`,
    { fields: { notified: { booleanValue: true } } }, { allowConflict: true });
  if (!marked) return { sent: false, reason: "already notified" };

  await sendTelegram(env, orderMessage(orderId, order, env));
  return { sent: true };
}

async function myOrders(request, env) {
  const { phone } = await readJson(request);
  const digits = typeof phone === "string" ? phone.replace(/\D/g, "") : "";
  if (!/^0\d{8,9}$/.test(digits)) throw new HttpError(400, "invalid phone");

  const token = await botToken(env);
  const rows = await firestore(env, token, "POST", ":runQuery", {
    structuredQuery: {
      from: [{ collectionId: "order" }],
      // เบอร์ที่ลูกค้าพิมพ์ตอนสั่งอาจมีขีด เลยค้นทั้งแบบที่พิมพ์มาและแบบตัวเลขล้วน
      where: { fieldFilter: { field: { fieldPath: "customerPhone" }, op: "IN", value: { arrayValue: { values: phoneVariants(digits, phone).map((p) => ({ stringValue: p })) } } } },
      limit: 50,
    },
  });

  const orders = (rows || [])
    .filter((r) => r.document)
    .map((r) => fromFirestore(r.document.fields))
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, MAX_LOOKUP_RESULTS)
    .map((o) => ({
      // ไม่ส่งชื่อ/เบอร์เต็มกลับไป: คนที่รู้แค่เบอร์จะไม่ได้ข้อมูลส่วนตัวเพิ่ม
      customerName: maskName(o.customerName),
      customerPhone: "xxx-xxx-" + digits.slice(-4),
      timestamp: o.timestamp || null,
      items: (o.items || []).map((i) => ({ name: i.name, qty: i.qty, price: i.price, subtotal: i.subtotal })),
      totalPrice: o.totalPrice,
    }));
  return { orders };
}

// ---------- Telegram ----------

function orderMessage(orderId, order, env) {
  const items = (order.items || [])
    .map((i) => `📌 ${i.name} (฿${i.price} x ${i.qty}) = ฿${i.subtotal ?? i.price * i.qty}`)
    .join("\n");
  const time = new Date(order.timestamp).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const line = "━━━━━━━━━━━━━━━━━━";
  return [
    "📝 คำสั่งซื้อหน้าร้านใหม่!", line,
    `🔹 Order ID: ${orderId}`,
    `👤 ลูกค้า: ${order.customerName} (${order.customerPhone})`, line,
    "📦 รายการสินค้า:", items, line,
    `💰 ยอดรวม: ฿${Number(order.totalPrice).toFixed(2)}`, line,
    `⏰ เวลาที่สั่ง: ${time}`, line,
    `🌳 ${env.SITE_URL}/orders.html`,
  ].join("\n");
}

async function sendTelegram(env, text) {
  // ส่งเป็นข้อความธรรมดา (ไม่ใช้ Markdown) ชื่อลูกค้าที่มีอักขระพิเศษจึงไม่ทำให้ข้อความพัง
  const res = await fetch(`${env.TELEGRAM_API}/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
  });
  if (!res.ok) throw new Error(`telegram ${res.status}`);
}

// ---------- Firebase (REST) ----------

let cachedToken = null; // { idToken, expiresAt } — reused while this Worker instance is warm

async function botToken(env) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.idToken;
  const res = await fetch(`${env.AUTH_API}/v1/accounts:signInWithPassword?key=${env.FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: env.BOT_EMAIL, password: env.BOT_PASSWORD, returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`bot sign-in failed ${res.status}`);
  const data = await res.json();
  cachedToken = { idToken: data.idToken, expiresAt: Date.now() + Number(data.expiresIn) * 1000 };
  return cachedToken.idToken;
}

async function firestore(env, token, method, path, body, { allowConflict = false } = {}) {
  const base = `${env.FIRESTORE_API}/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const res = await fetch(path.startsWith(":") ? base + path : `${base}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404 && method === "GET") return null;
  if (allowConflict && [400, 403, 409, 412].includes(res.status)) return null; // already marked / precondition failed
  if (!res.ok) throw new Error(`firestore ${method} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Firestore REST values -> plain JS values
function fromFirestore(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = fromValue(v);
  return out;
}
function fromValue(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("mapValue" in v) return fromFirestore(v.mapValue.fields);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
  return null;
}

// ---------- helpers ----------

// รูปแบบเบอร์ที่ลูกค้าอาจพิมพ์ตอนสั่ง: 0812345678, 081-234-5678, 081 234 5678 (และแบบเบอร์บ้าน 9 หลัก)
function phoneVariants(digits, typed) {
  const d = digits;
  const v = [d, typed.trim()];
  if (d.length === 10) v.push(`${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`, `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`, `${d.slice(0, 3)}-${d.slice(3)}`);
  if (d.length === 9) v.push(`${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`, `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`);
  return [...new Set(v)];
}

function maskName(name) {
  const chars = Array.from(String(name || ""));
  return chars.length <= 1 ? "***" : chars.slice(0, 2).join("") + "***";
}

// อนุญาตเฉพาะหน้าเว็บของร้าน (รวมลิงก์ทดลอง Preview Channel)
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  const ok = allowed.includes(origin) || new RegExp(env.PREVIEW_ORIGIN_PATTERN).test(origin);
  if (!ok) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

async function readJson(request) {
  if (Number(request.headers.get("Content-Length") || 0) > 2048) throw new HttpError(413, "body too large");
  try { return await request.json(); } catch { throw new HttpError(400, "invalid JSON"); }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
