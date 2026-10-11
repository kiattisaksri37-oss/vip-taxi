// Cloud Functions ของ VIP Taxi: ส่งแจ้งเตือนเด้งขึ้นมือถือคนขับ และเตือนบิลค้างตามเวลา
// ต้องใช้แผน Blaze (จ่ายตามใช้ ปริมาณระดับนี้ปกติยังอยู่ในโควตาฟรี)
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const REGION = 'asia-southeast1';
const TZ = 'Asia/Bangkok';

// ---------- 1) ส่ง push ทุกครั้งที่มีข้อความใหม่ในกล่องข้อความของคนขับ ----------
exports.pushNotif = onDocumentCreated({ document: 'drivers/{driverId}/notifs/{nid}', region: REGION }, async (event) => {
  const n = event.data && event.data.data();
  if (!n) return;
  const { driverId } = event.params;
  const snap = await db.collection(`drivers/${driverId}/tokens`).get();
  const tokens = snap.docs.map((d) => d.data().token).filter(Boolean);
  if (!tokens.length) return;
  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title: n.title || 'VIP Taxi', body: n.body || '' },
    data: { type: String(n.type || ''), nid: event.params.nid },
    android: { priority: 'high', notification: { channelId: 'vip-default', sound: 'default' } },
    webpush: { fcmOptions: { link: '/' } },
  });
  // ลบ token ที่ใช้ไม่ได้แล้ว (ถอนการติดตั้ง ฯลฯ)
  const dead = [];
  res.responses.forEach((r, i) => {
    const c = r.error && r.error.code;
    if (c === 'messaging/registration-token-not-registered' || c === 'messaging/invalid-registration-token') dead.push(tokens[i]);
  });
  await Promise.all(snap.docs.filter((d) => dead.includes(d.data().token)).map((d) => d.ref.delete()));
});

// ---------- 2) เตือนบิลค้างตามเวลา และเตือนก่อนค่าปรับขึ้น (ทุก 5 นาที) ----------
const money = (n) => (+n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const total = (b) => Math.max(0, Math.round(((b.items || []).reduce((s, i) => s + (+i.qty || 0) * (+i.price || 0), 0) - (+b.discount || 0)) * 100) / 100);
const paid = (b) => Math.round((b.payments || []).reduce((s, p) => s + (+p.amount || 0), 0) * 100) / 100;
const balance = (b) => (b.void ? 0 : Math.max(0, Math.round((total(b) - paid(b)) * 100) / 100));

function bangkokNow() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).reduce((o, p) => ((o[p.type] = p.value), o), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, min: +parts.hour * 60 + +parts.minute };
}
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
const WINDOW = 5; // นาที ต้องเท่ากับความถี่ของ schedule

exports.sweepReminders = onSchedule({ schedule: 'every 5 minutes', timeZone: TZ, region: REGION }, async () => {
  const cfgSnap = await db.doc('config/main').get();
  const c = cfgSnap.exists ? cfgSnap.data() : {};
  const N = Object.assign({ bill: true, late: true, remindTimes: ['09:30', '15:30'] }, c.notif || {});
  const L = c.late || {};
  const now = bangkokNow();

  // เวลาที่เข้าเกณฑ์ในรอบนี้: เวลาเตือนทั่วไป + 30 นาทีก่อนขั้นค่าปรับตามช่วงเวลา
  const slots = [];
  if (N.bill !== false) (N.remindTimes || []).forEach((t) => slots.push({ key: t, kind: 'remind', at: toMin(t) }));
  if (N.late !== false && L.on !== false && L.tOn) (L.tiers || []).forEach((t) => {
    if (/^\d{1,2}:\d{2}$/.test(t.time || '') && +t.amount > 0) slots.push({ key: 'tier' + t.time, kind: 'tier', at: toMin(t.time) - 30, tier: t });
  });
  const due = slots.filter((s) => now.min >= s.at && now.min < s.at + WINDOW);
  if (!due.length) return;

  const bills = await db.collection('bills').get();
  const open = bills.docs.map((d) => ({ id: d.id, ...d.data() })).filter((b) => b.driverId && balance(b) > 0 && (!b.dueDate || b.dueDate <= now.date));
  const byDriver = {};
  open.forEach((b) => (byDriver[b.driverId] = byDriver[b.driverId] || []).push(b));

  for (const [driverId, list] of Object.entries(byDriver)) {
    const sum = list.reduce((s, b) => s + balance(b), 0);
    for (const s of due) {
      let title, body;
      if (s.kind === 'remind') { title = 'แจ้งเตือนบิลค้างชำระ'; body = `คุณมีบิลค้าง ${list.length} ใบ รวม ฿${money(sum)} กรุณาชำระ`; }
      else {
        const eligible = list.filter((b) => b.lateRule && (b.lateRule.tiers || []).length && !b.waiveLate);
        if (!eligible.length) continue;
        title = `ใกล้ถึง ${s.tier.time} น. ค่าปรับจะเพิ่ม`;
        body = `${s.tier.label || 'ค่าปรับ'} +฿${money(s.tier.amount)} ต่อบิล ชำระก่อนเวลาเพื่อไม่ให้ถูกปรับ (ค้าง ฿${money(sum)})`;
      }
      const ref = db.doc(`drivers/${driverId}/notifs/${s.kind}_${now.date}_${s.key.replace(':', '')}`);
      try { // create = ไม่ซ้ำ ถ้ามีแล้วในวันนี้จะข้าม
        await ref.create({ type: 'remind', title, body, at: new Date().toISOString(), read: false });
      } catch (e) { if (e.code !== 6) console.error(e); }
    }
  }
});
