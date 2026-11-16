// Firestore rules tests for the Cloudflare Worker bot account (least privilege). Run with `npm test` in this folder.
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
const env = await initializeTestEnvironment({ projectId: 'demo-bot-rules', firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 } });
let pass = 0, fail = 0;
async function t(name, p) { try { await p; pass++; console.log('  OK  ', name); } catch (e) { fail++; console.log('  FAIL', name, String(e.message).slice(0, 100)); } }
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'bots/botUid'), { role: 'notifier' });
  await setDoc(doc(db, 'staff/staffUid'), { role: 'owner' });
  await setDoc(doc(db, 'orders/o1'), { customerName: 'X', customerPhone: '0811111111', items: [], totalPrice: 1, timestamp: new Date() });
  await setDoc(doc(db, 'orders/o2'), { customerName: 'X', customerPhone: '0811111111', items: [], totalPrice: 1, timestamp: new Date(), notified: true });
  await setDoc(doc(db, 'order/o1'), { customerName: 'X', customerPhone: '0811111111', items: [], totalPrice: 1, timestamp: new Date() });
  await setDoc(doc(db, 'stockLogs/l1'), { name: 'A' });
  await setDoc(doc(db, 'mama/m1'), { items: [{ name: 'A' }] });
});
const bot = env.authenticatedContext('botUid').firestore();
const guest = env.unauthenticatedContext().firestore();
const fake = env.authenticatedContext('someoneElse').firestore();
console.log('Bot (Cloudflare Worker)');
await t('get a new order', assertSucceeds(getDoc(doc(bot, 'orders/o1'))));
await t('mark order notified', assertSucceeds(updateDoc(doc(bot, 'orders/o1'), { notified: true })));
await t('DENY mark twice', assertFails(updateDoc(doc(bot, 'orders/o2'), { notified: true })));
await t('query order history by phone', assertSucceeds(getDocs(query(collection(bot, 'order'), where('customerPhone', '==', '0811111111')))));
await t('DENY list current orders', assertFails(getDocs(collection(bot, 'orders'))));
await t('DENY change order total', assertFails(updateDoc(doc(bot, 'orders/o2'), { totalPrice: 0 })));
await t('DENY delete order', assertFails(deleteDoc(doc(bot, 'orders/o1'))));
await t('DENY edit order history', assertFails(updateDoc(doc(bot, 'order/o1'), { totalPrice: 0 })));
await t('DENY read stock logs', assertFails(getDocs(collection(bot, 'stockLogs'))));
await t('DENY delete stock', assertFails(deleteDoc(doc(bot, 'mama/m1'))));
await t('DENY read staff list', assertFails(getDoc(doc(bot, 'staff/staffUid'))));
await t('DENY read/write bots list', assertFails(getDoc(doc(bot, 'bots/botUid'))));
console.log('Others');
await t('DENY guest create order with notified=true', assertFails(addDoc(collection(guest, 'orders'), { customerName: 'a', customerPhone: '0812345678', items: [{ name: 'A' }], totalPrice: 1, timestamp: serverTimestamp(), notified: true })));
await t('DENY non-bot marking notified', assertFails(updateDoc(doc(fake, 'orders/o1'), { notified: true })));
await t('DENY make self a bot', assertFails(setDoc(doc(fake, 'bots/someoneElse'), { role: 'notifier' })));
console.log(`\nRESULT: passed ${pass} / failed ${fail}`);
await env.cleanup(); process.exit(fail ? 1 : 0);
