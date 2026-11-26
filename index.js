// ============================================================
//  بوت «حمو المزعج» على واتساب بمخ Gemini
//  الإعدادات كلها هنا فوق. اللي تحت الخط الكبير مفيش داعي تلمسه.
//  معلومات شغلك (منتجات، أسعار، توصيل) في ملف business.txt
// ============================================================

// شخصية البوت (بالمصري). عدّلها براحتك
const SYSTEM_PROMPT = `
انت "بوت حمو المزعج"، مساعد ودود بتتكلم باللهجة المصرية.
انت بترد على رسائل الواتساب بدل حمو (صاحب الرقم). لو حد سأل انت مين قوله انك بوت حمو المزعج المساعد.
أول ما حد يكلمك رحّب بيه بابتسامة واسأله: "أقدر أساعدك في إيه؟"
ردودك قصيرة وواضحة ومؤدبة.
`;

// كلمتين التحكم: ابعتهم من رقمك انت (الأفضل في شات "رسالة لنفسك")
const WORD_ON = 'تشغيل';
const WORD_OFF = 'ايقاف'; // بتشتغل برضو لو كتبتها «إيقاف» بالهمزة

// ---- مواعيد الشغل (بتوقيت مصر) ----
const AFTER_HOURS_ENABLED = true;   // خليها false لو مش عايز رسالة "إحنا مقفولين"
const OPEN_HOUR = 10;               // الساعة اللي بتفتح فيها (10 = 10 الصبح)
const CLOSE_HOUR = 22;              // الساعة اللي بتقفل فيها (22 = 10 بالليل)
const OFF_DAYS = [5];               // أيام الإجازة: 0=الأحد 1=الاتنين ... 5=الجمعة 6=السبت. [] يعني مفيش إجازة
const AFTER_HOURS_MESSAGE =
  'أهلاً بيك 🌙 إحنا دلوقتي مقفولين. هنرد عليك أول ما نفتح (من الساعة 10 الصبح). ابعت طلبك وهنكلمك بإذن الله.';

// رقم صاحب الشغل اللي بتوصله الطلبات والأسئلة. سيبه فاضي = هتوصلك في شات "رسالة لنفسك"
// ممكن تكتبه هنا أو في متغير OWNER_NUMBER. بالكود الدولي من غير + (مثال: 201091803369)
const OWNER_NUMBER = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');

// لو عايز البوت يرد على الجروبات كمان خليها true (مش مستحسن)
const REPLY_IN_GROUPS = false;

// ============================================================
//  من هنا ومنزل: كود التشغيل. مفيش داعي تلمسه
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const API_KEY = process.env.GEMINI_API_KEY;
const MODELS = [process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-flash-latest'];
const PORT = process.env.PORT || 3000;
const PHONE_NUMBER = (process.env.PHONE_NUMBER || '').replace(/\D/g, ''); // اختياري: للربط بكود بدل QR
const IMG_DIR = path.join(__dirname, 'images');
const TZ = 'Africa/Cairo';

// ---------- معلومات الشغل ----------
function loadBusiness() {
  try {
    return fs.readFileSync(path.join(__dirname, 'business.txt'), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('#')).join('\n').trim();
  } catch (_) {
    return '';
  }
}
const BUSINESS = loadBusiness();

function listImages() {
  try {
    return fs.readdirSync(IMG_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  } catch (_) {
    return [];
  }
}
const imgKey = (f) => f.replace(/\.[^.]+$/, '').trim().toLowerCase();

function buildSystem() {
  const imgs = listImages().map(imgKey);
  return `${SYSTEM_PROMPT}

=== معلومات الشغل (ده كل اللي تعرفه، ما تألفش حاجة برا الكلام ده) ===
${BUSINESS || '(لسه مفيش معلومات مكتوبة)'}
=== نهاية المعلومات ===

صور المنتجات المتاحة (بالاسم): ${imgs.length ? imgs.join(' | ') : 'مفيش'}

لازم ترد بصيغة JSON بس، من غير أي كلام برا الـ JSON، بالشكل ده:
{"reply": "ردك للعميل بالمصري",
 "action": "none" أو "order" أو "unknown" أو "image",
 "order": {"name": "", "address": "", "phone": "", "details": ""},
 "question": "",
 "image": ""}
القواعد:
- action = "order" بس لما العميل يأكد إنه عايز يطلب وتكون خدت منه الاسم والعنوان والرقم وتفاصيل الطلب كلهم. لو ناقص حاجة اسأله عليها واخليها "none" ولخّص الطلب في reply.
- action = "unknown" لو العميل سأل عن حاجة مش موجودة في معلومات الشغل. في reply قوله إنك هتسأل وترجعله، وفي question اكتب سؤاله.
- action = "image" لو العميل بيسأل عن منتج ليه صورة في القايمة. في image اكتب اسم الصورة زي ما هو في القايمة بالظبط.
- غير كده action = "none".`;
}

// ---------- حالة التشغيل (بيبدأ مقفول) ----------
const STATE_FILE = './bot-state.json';
let active = false;
try { active = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).active === true; } catch (_) {}
function setActive(v) {
  active = v;
  try { fs.writeFileSync(STATE_FILE, JSON.stringify({ active })); } catch (_) {}
}
const norm = (t) => (t || '').trim().replace(/[إأآ]/g, 'ا').replace(/[.!؟?\s]+$/g, '');

// ---------- مواعيد الشغل ----------
function isOpenNow(date = new Date()) {
  if (!AFTER_HOURS_ENABLED) return true;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(date)) % 24;
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(date);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
  if (OFF_DAYS.includes(day)) return false;
  return OPEN_HOUR < CLOSE_HOUR ? hour >= OPEN_HOUR && hour < CLOSE_HOUR : hour >= OPEN_HOUR || hour < CLOSE_HOUR;
}
const closedNotice = new Map(); // آخر مرة قلنا للعميل إننا مقفولين
const NOTICE_EVERY_MS = 8 * 60 * 60 * 1000;

// ---------- Gemini ----------
const history = new Map();
const MAX_TURNS = 12;

function parseAnswer(text) {
  try {
    const clean = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const j = JSON.parse(clean);
    if (j && typeof j.reply === 'string') return j;
  } catch (_) {}
  return { reply: text, action: 'none' };
}

async function askGemini(chatId, userText) {
  const turns = history.get(chatId) || [];
  turns.push({ role: 'user', parts: [{ text: userText }] });
  while (turns.length > MAX_TURNS) turns.shift();
  const body = {
    systemInstruction: { parts: [{ text: buildSystem() }] },
    contents: turns,
    generationConfig: { responseMimeType: 'application/json' },
  };
  let lastErr;
  for (const model of MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) {
        lastErr = `${model}: ${r.status} ${data?.error?.message || ''}`;
        if (r.status === 404 || r.status === 400) continue;
        throw new Error(lastErr);
      }
      const raw = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
      if (!raw) throw new Error('رد فاضي');
      const ans = parseAnswer(raw);
      turns.push({ role: 'model', parts: [{ text: ans.reply }] });
      while (turns.length > MAX_TURNS) turns.shift();
      history.set(chatId, turns);
      return ans;
    } catch (e) {
      lastErr = e.message;
    }
  }
  turns.pop();
  throw new Error(lastErr);
}

function findImage(name) {
  const key = (name || '').trim().toLowerCase();
  if (!key) return null;
  const files = listImages();
  const f = files.find((x) => imgKey(x) === key) || files.find((x) => imgKey(x).includes(key) || key.includes(imgKey(x)));
  return f ? path.join(IMG_DIR, f) : null;
}

// الشغل الأساسي لرسالة عميل. t = { chatId, text, reply(text), sendImage(path), notifyOwner(text), who }
async function handleCustomer(t) {
  if (!active) return;
  if (!isOpenNow()) {
    const last = closedNotice.get(t.chatId) || 0;
    if (Date.now() - last > NOTICE_EVERY_MS) {
      closedNotice.set(t.chatId, Date.now());
      await t.reply(AFTER_HOURS_MESSAGE);
    }
    return;
  }
  const a = await askGemini(t.chatId, t.text);
  await t.reply(a.reply);
  if (a.action === 'order' && a.order) {
    const o = a.order;
    await t.notifyOwner(
      `🛒 طلب جديد!\n━━━━━━━━━━\n👤 الاسم: ${o.name || '-'}\n📞 الرقم: ${o.phone || '-'}\n📍 العنوان: ${o.address || '-'}\n📦 الطلب: ${o.details || '-'}\n━━━━━━━━━━\n💬 واتساب العميل: ${t.who}`
    );
  } else if (a.action === 'unknown') {
    await t.notifyOwner(
      `❓ سؤال البوت ماعرفش يجاوب عليه\n━━━━━━━━━━\n${a.question || t.text}\n━━━━━━━━━━\n💬 العميل: ${t.who}\n✍️ ضيف الإجابة في business.txt والبوت هيعرفها.`
    );
  } else if (a.action === 'image') {
    const p = findImage(a.image);
    if (p) await t.sendImage(p);
  }
}

// ---------- سيرفر صغير بيفضل صاحي ----------
let status = 'starting';
function startServer() {
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Hamo El-Mozeg bot - status: ' + status + ' - auto-reply: ' + (active ? 'ON' : 'OFF'));
    })
    .listen(PORT, () => console.log('Keep-alive page on port ' + PORT));
}

// ---------- واتساب ----------
async function pickWebVersion() {
  // نسخة واتساب ويب اللي اتجربت وشغالة مع المكتبة. لو عملت مشكلة اتصل بالدعم
  const base = 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/';
  const candidates = [process.env.WA_VER, '2.3000.1054445547-alpha', '2.3000.1048563346-alpha'].filter(Boolean);
  for (const v of candidates) {
    try {
      if ((await fetch(`${base}${v}.html`, { method: 'HEAD' })).ok) return { type: 'remote', remotePath: `${base}${v}.html` };
    } catch (_) {}
  }
  return undefined;
}

function start() {
  if (!API_KEY) console.log('❌ مفيش مفتاح Gemini. ضيف GEMINI_API_KEY في الإعدادات (Environment).');
  startServer();
  (async () => {
    const client = new Client({
      webVersionCache: await pickWebVersion(),
      authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
      pairWithPhoneNumber: PHONE_NUMBER ? { phoneNumber: PHONE_NUMBER, showNotification: true } : undefined,
      puppeteer: {
        headless: true,
        executablePath: process.env.CHROME_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions', '--disable-background-networking'],
      },
    });
    const ownerId = () => (OWNER_NUMBER ? `${OWNER_NUMBER}@c.us` : client.info?.wid?._serialized);
    const tellOwner = async (text) => {
      const id = ownerId();
      if (id) await client.sendMessage(id, text);
    };

    client.on('code', (code) => {
      status = 'waiting for pairing code';
      console.log('\n🔢 كود الربط بتاعك: ' + code + '\nافتح واتساب > الأجهزة المرتبطة > ربط جهاز > "الربط برقم الهاتف بدلاً من ذلك" واكتب الكود ده.\n');
    });
    client.on('qr', async (qr) => {
      status = 'waiting for QR scan';
      console.log('\n📱 امسح الكود ده من واتساب (الأجهزة المرتبطة). لو مش باين كويس صغّر الصفحة (zoom out):\n');
      require('qrcode-terminal').generate(qr, { small: true });
    });
    client.on('authenticated', () => console.log('🔐 تم الربط'));
    client.on('auth_failure', (m) => console.log('❌ فشل الربط: ' + m));
    client.on('ready', () => {
      status = 'ready';
      console.log('✅ البوت متوصل بواتساب. الرد التلقائي: ' + (active ? 'شغال' : `مقفول (ابعت "${WORD_ON}" من رقمك)`));
      tellOwner(`🤖 بوت حمو المزعج اتوصل بنجاح. الرد التلقائي دلوقتي: ${active ? 'شغال ✅' : 'مقفول ⛔'}\nابعت "${WORD_ON}" لتشغيله و"إيقاف" لإيقافه.`).catch(() => {});
    });
    client.on('disconnected', (why) => {
      status = 'disconnected';
      console.log('⚠️ الاتصال فصل: ' + why);
      process.exit(1);
    });

    // كلمات التحكم من رسايلك انت
    client.on('message_create', async (msg) => {
      try {
        if (!msg.fromMe || msg.type !== 'chat') return;
        if (msg.to && msg.to.endsWith('@g.us')) return;
        const w = norm(msg.body);
        const me = client.info?.wid?._serialized;
        if (w === norm(WORD_ON)) {
          setActive(true);
          console.log('Auto-reply ON');
          if (me) await client.sendMessage(me, '✅ تمام يا حمو، بوت حمو المزعج اشتغل ودلوقتي هيرد على أي حد يكلمك.');
        } else if (w === norm(WORD_OFF)) {
          setActive(false);
          console.log('Auto-reply OFF');
          if (me) await client.sendMessage(me, '⛔ تمام يا حمو، البوت وقف ومش هيرد على حد.');
        }
      } catch (e) {
        console.log('Control error: ' + e.message);
      }
    });

    const busy = new Set();
    client.on('message', async (msg) => {
      try {
        if (!active || msg.fromMe || msg.isStatus || msg.from === 'status@broadcast') return;
        if (msg.from.endsWith('@g.us') && !REPLY_IN_GROUPS) return;
        if (busy.has(msg.from)) return;
        busy.add(msg.from);
        try {
          if (msg.type !== 'chat' || !msg.body) {
            await msg.reply('معلش، أنا بفهم الرسايل المكتوبة بس. ممكن تكتبلي طلبك؟ 🙏');
            return;
          }
          const chat = await msg.getChat();
          if (isOpenNow()) await chat.sendStateTyping();
          await handleCustomer({
            chatId: msg.from,
            text: msg.body,
            who: '+' + msg.from.replace(/@.*/, ''),
            reply: (x) => msg.reply(x),
            sendImage: (p) => client.sendMessage(msg.from, MessageMedia.fromFilePath(p)),
            notifyOwner: tellOwner,
          });
        } finally {
          busy.delete(msg.from);
        }
      } catch (e) {
        console.log('Error: ' + e.message);
        try { await msg.reply('معلش حصلت مشكلة صغيرة عندي، ابعتلي تاني بعد شوية 🙏'); } catch (_) {}
      }
    });

    await client.initialize();
  })().catch((e) => {
    console.log('❌ مشكلة في التشغيل: ' + e.message);
    process.exit(1);
  });
}

if (require.main === module) start();
else module.exports = { handleCustomer, isOpenNow, norm, setActive, parseAnswer };
