// ระบบล็อกอินสำหรับหน้าพนักงาน (ขายหน้าร้าน, จัดการออร์เดอร์, ตัดสต็อก, สรุปยอด)
// Staff login guard: hides the page until a signed-in staff member is confirmed,
// otherwise redirects to login.html. Page code that reads private data must run inside onStaffReady().
//
// พนักงาน = บัญชีใน Firebase Authentication ที่มีเอกสาร staff/{uid} ใน Firestore
// Staff = a Firebase Auth user who also has a staff/{uid} document (added by the owner in the console).

(function () {
  // ซ่อนหน้าไว้ก่อน จนกว่าจะยืนยันตัวตนเสร็จ (กันข้อมูลโผล่แวบหนึ่ง)
  const hide = document.createElement("style");
  hide.id = "staff-auth-hide";
  hide.textContent = "body { visibility: hidden; }";
  document.head.appendChild(hide);

  let staffReady = null;

  function goToLogin(reason) {
    const page = window.location.pathname.split("/").pop() || "orders.html";
    const params = new URLSearchParams({ next: page });
    if (reason) params.set("reason", reason);
    window.location.replace("login.html?" + params.toString());
  }

  // แสดงอีเมลแบบย่อ (5 ตัวแรก) ให้ไม่เกะกะ ชี้เมาส์ค้างไว้จะเห็นอีเมลเต็ม
  function shortName(email) {
    const name = (email || "staff").split("@")[0];
    return name.length > 5 ? name.slice(0, 5) + "…" : name;
  }

  function addLogoutButton(user) {
    const bar = document.createElement("div");
    bar.className = "staff-bar"; // สีและตำแหน่งอยู่ใน css/theme.css
    const who = document.createElement("span");
    who.textContent = "👤 " + shortName(user.email);
    who.title = user.email || "";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "ออกจากระบบ";
    btn.addEventListener("click", () => firebase.auth().signOut().then(() => goToLogin()));
    bar.append(who, btn);
    document.body.appendChild(bar);
  }

  function waitForStaff() {
    if (staffReady) return staffReady;
    staffReady = new Promise((resolve) => {
      const unsubscribe = firebase.auth().onAuthStateChanged(async (user) => {
        unsubscribe();
        if (!user) return goToLogin();
        try {
          const staffDoc = await firebase.firestore().collection("staff").doc(user.uid).get();
          if (!staffDoc.exists) throw new Error("not staff");
        } catch (e) {
          await firebase.auth().signOut();
          return goToLogin("not-staff");
        }
        const show = () => {
          addLogoutButton(user);
          document.getElementById("staff-auth-hide")?.remove();
          resolve(user);
        };
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show);
        else show();
      });
    });
    return staffReady;
  }

  // ใช้แทน document.addEventListener("DOMContentLoaded", fn) ในหน้าพนักงาน
  // Runs fn after the DOM is ready AND the staff member is signed in.
  window.onStaffReady = function (fn) {
    waitForStaff().then((user) => fn(user));
  };
})();
