// Firestore rules tests: customers, signed-in strangers and staff. Run with `npm test` in this folder (uses the local emulator only).
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, getDocs, query, where, serverTimestamp } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-jojutjan',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
});
let pass = 0, fail = 0;
async function t(name, p) {
  try { await p; pass++; console.log('  OK  ', name); }
  catch (e) { fail++; console.log('  FAIL', name, '-', String(e.message).slice(0, 120)); }
}

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'staff/staffUid'), { role: 'owner' });
  await setDoc(doc(db, 'mama/stock1'), { items: [{ name: 'A', qty: 10, price: 30, remainingQty: 10 }, { name: 'B', qty: 5, price: 40 }], timestamp: new Date() });
  await setDoc(doc(db, 'orders/o1'), { customerName: 'X', customerPhone: '0811111111', items: [], totalPrice: 1, timestamp: new Date() });
  await setDoc(doc(db, 'order/o1'), { customerName: 'X', customerPhone: '0811111111', items: [], totalPrice: 1, timestamp: new Date() });
  await setDoc(doc(db, 'stockLogs/l1'), { name: 'A', action: 'cut' });
  await setDoc(doc(db, 'settings/video'), { url: 'https://youtube.com/embed/x' });
});

const guest = env.unauthenticatedContext().firestore();
const stranger = env.authenticatedContext('randomUid').firestore(); // signed up, but not staff
const staff = env.authenticatedContext('staffUid').firestore();
const goodOrder = () => ({ customerName: 'Somchai', customerPhone: '0812345678', items: [{ name: 'A', qty: 2, price: 30, subtotal: 60 }], totalPrice: 60, timestamp: serverTimestamp() });
const BUY = 'สั่งซื้อ';

console.log('Guest (customer, not signed in)');
await t('read stock', assertSucceeds(getDoc(doc(guest, 'mama/stock1'))));
await t('read video link', assertSucceeds(getDoc(doc(guest, 'settings/video'))));
await t('create order in orders', assertSucceeds(addDoc(collection(guest, 'orders'), goodOrder())));
await t('create order in order (history)', assertSucceeds(addDoc(collection(guest, 'order'), goodOrder())));
await t('deduct stock (update items only)', assertSucceeds(updateDoc(doc(guest, 'mama/stock1'), { items: [{ name: 'A', qty: 10, price: 30, remainingQty: 8 }, { name: 'B', qty: 5, price: 40 }] })));
await t('add purchase stock log', assertSucceeds(addDoc(collection(guest, 'stockLogs'), { name: 'A', qty: 2, price: 30, remainingQty: 8, action: BUY, timestamp: serverTimestamp() })));
await t('DENY list orders', assertFails(getDocs(collection(guest, 'orders'))));
await t('DENY read order history', assertFails(getDoc(doc(guest, 'order/o1'))));
await t('DENY query orders by phone', assertFails(getDocs(query(collection(guest, 'order'), where('customerPhone', '==', '0811111111')))));
await t('DENY read stock logs', assertFails(getDocs(collection(guest, 'stockLogs'))));
await t('DENY delete order', assertFails(deleteDoc(doc(guest, 'orders/o1'))));
await t('DENY edit order', assertFails(updateDoc(doc(guest, 'orders/o1'), { totalPrice: 0 })));
await t('DENY order with extra field', assertFails(addDoc(collection(guest, 'orders'), { ...goodOrder(), isPaid: true })));
await t('DENY order without name', assertFails(addDoc(collection(guest, 'orders'), { ...goodOrder(), customerName: '' })));
await t('DENY order with fake time', assertFails(addDoc(collection(guest, 'orders'), { ...goodOrder(), timestamp: new Date(2020, 1, 1) })));
await t('DENY order with empty cart', assertFails(addDoc(collection(guest, 'orders'), { ...goodOrder(), items: [] })));
await t('DENY delete stock document', assertFails(deleteDoc(doc(guest, 'mama/stock1'))));
await t('DENY remove products from list', assertFails(updateDoc(doc(guest, 'mama/stock1'), { items: [] })));
await t('DENY edit other stock fields', assertFails(updateDoc(doc(guest, 'mama/stock1'), { timestamp: new Date() })));
await t('DENY create stock document', assertFails(setDoc(doc(guest, 'mama/fake'), { items: [] })));
await t('DENY change video link', assertFails(setDoc(doc(guest, 'settings/video'), { url: 'https://evil.example' })));
await t('DENY non-purchase stock log', assertFails(addDoc(collection(guest, 'stockLogs'), { name: 'A', action: 'cut', timestamp: serverTimestamp() })));
await t('DENY make self staff', assertFails(setDoc(doc(guest, 'staff/me'), { role: 'owner' })));
await t('DENY unknown collection', assertFails(setDoc(doc(guest, 'other/x'), { a: 1 })));

console.log('Signed in but NOT staff');
await t('DENY list orders', assertFails(getDocs(collection(stranger, 'orders'))));
await t('DENY make self staff', assertFails(setDoc(doc(stranger, 'staff/randomUid'), { role: 'owner' })));
await t('DENY delete stock', assertFails(deleteDoc(doc(stranger, 'mama/stock1'))));
await t('read own staff doc (to check access)', assertSucceeds(getDoc(doc(stranger, 'staff/randomUid'))));
await t('DENY read someone else staff doc', assertFails(getDoc(doc(stranger, 'staff/staffUid'))));

console.log('Staff');
await t('list orders', assertSucceeds(getDocs(collection(staff, 'orders'))));
await t('list order history', assertSucceeds(getDocs(collection(staff, 'order'))));
await t('delete order', assertSucceeds(deleteDoc(doc(staff, 'orders/o1'))));
await t('read stock logs', assertSucceeds(getDocs(collection(staff, 'stockLogs'))));
await t('add cut stock log', assertSucceeds(addDoc(collection(staff, 'stockLogs'), { name: 'A', action: 'cut', timestamp: serverTimestamp() })));
await t('delete stock log', assertSucceeds(deleteDoc(doc(staff, 'stockLogs/l1'))));
await t('create stock document', assertSucceeds(addDoc(collection(staff, 'mama'), { items: [{ name: 'C' }], timestamp: serverTimestamp() })));
await t('edit stock freely', assertSucceeds(updateDoc(doc(staff, 'mama/stock1'), { items: [] })));
await t('delete stock document', assertSucceeds(deleteDoc(doc(staff, 'mama/stock1'))));
await t('set video link', assertSucceeds(setDoc(doc(staff, 'settings/video'), { url: 'https://youtube.com/embed/y' })));
await t('DENY edit staff list from web', assertFails(setDoc(doc(staff, 'staff/other'), { role: 'owner' })));

console.log(`\nRESULT: passed ${pass} / failed ${fail}`);
await env.cleanup();
process.exit(fail ? 1 : 0);
