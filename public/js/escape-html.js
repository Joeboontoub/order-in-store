// ป้องกัน XSS: แปลงอักขระพิเศษก่อนนำข้อมูล (จาก Firestore / localStorage / ผู้ใช้) ไปใส่ใน innerHTML
// Prevent XSS: escape special characters before putting data into innerHTML.
function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// อนุญาตเฉพาะลิงก์ http/https (กันลิงก์แบบ javascript:)
// Allow only http/https links (blocks javascript: URLs).
function safeUrl(url) {
  try {
    const parsed = new URL(String(url), window.location.href);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "#";
  } catch (e) {
    return "#";
  }
}
