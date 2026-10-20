// Vercel serverless: chat with the book, grounded in the user's saved profile
// and recent chat history. Uses MiniMax (OpenRouter) + the Ashtanga Hridaya.
const BOOK = require("../book.js");

function pickFor(text, dosha) {
  const t = (text || "").toLowerCase();
  const words = t.split(/[^a-z]+/).filter(w => w.length > 3);
  const life = new Set(["Daily Routine","Diet & Food","Digestion","Dosha Balance","Sleep","Energy","Seasonal","Prevention","Drinks","General","Eyes/Head","Detox"]);
  return BOOK.remedies.map(r => {
    let s = 0;
    if (dosha && (r.dosha || "").includes(dosha === "V" ? "Vata" : dosha === "P" ? "Pitta" : "Kapha")) s += 2;
    if (life.has(r.category)) s += 1;
    const hay = (r.problem + " " + r.guidance).toLowerCase();
    for (const w of words) if (hay.includes(w)) s += 2;
    return { r, s };
  }).filter(x => x.s > 1).sort((a, b) => b.s - a.s).slice(0, 18).map(x => x.r);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) { res.status(500).json({ error: "LLM not configured" }); return; }
  let body = req.body;
  try { if (typeof body === "string") body = JSON.parse(body); } catch { body = {}; }
  const profile = (body && body.profile) || {};
  const history = Array.isArray(body && body.history) ? body.history.slice(-8) : [];
  const log = (body && body.log || "").toString().slice(0, 1500);
  const topic = (body && body.topic) || null;
  const learned = Array.isArray(body && body.learned) ? body.learned.slice(0, 20).map(x => String(x).slice(0, 180)) : [];
  const message = (body && body.message || "").toString().slice(0, 1200);
  if (!message.trim()) { res.status(400).json({ error: "empty message" }); return; }

  const i = profile.intake || {};
  const rel = pickFor(message + " " + (i.problems || ""), profile.dosha);
  const relText = rel.map(r => `- [${r.category}] ${r.problem}: ${r.guidance} (Ch ${r.chapter})`).join("\n");
  const person = `Dosha: ${profile.doshaName || "unknown"}${profile.second ? " + " + profile.second : ""}. Wake ${i.wake || "?"}, sleep ${i.sleep || "?"}, meals ${i.meals || "?"} (${i.regular || "?"}). Exercise: ${i.exercise || "?"}. Mental: ${i.mental || "?"}. Physical: ${i.physical || "?"}. Enjoys: ${i.likes || "?"}. Avoids: ${i.dislikes || "?"}. Their problems: ${i.problems || "?"}`;

  const system = `You are the user's personal Ayurvedic guide, speaking with them over time. You answer ONLY from the classical Ashtanga Hridaya material and principles provided — do not invent herbs, medicines, dosages, branded products or remedies beyond it.

Use their saved profile, their recent daily check-in log, and the conversation so far to stay personal, consistent and accurate. Remember what they have told you. When a daily log is present, speak to their ACTUAL recent behaviour (e.g. "you've eaten late most days this week") instead of generic advice, praise honest effort, and give ONE concrete small step at a time rather than a long list.

MOVEMENT/ASANA NOTE: This book is a medical text. It teaches exercise (vyayama) in general — move daily to about half your capacity, more in cool seasons, gently if weak — but it does NOT prescribe named yoga asanas. Ground movement advice in the book's vyayama guidance. If you ever suggest a specific gentle posture or breathing practice, clearly say it is a general wellbeing suggestion, not from this text.

SAFETY (strict): This is educational lifestyle guidance, not medical advice or diagnosis. If they mention depression, anxiety, any mental-health issue, being on/off medication, a serious or worsening illness, pregnancy, or a child's health: kindly urge them to see a doctor / mental-health professional / registered Ayurvedic practitioner, frame Ayurveda only as support alongside professional care, and NEVER suggest stopping or changing prescribed medicine. Never promise cures.

STYLE: Reply in the same language the user writes in. Warm, concrete, encouraging, plain words, short paragraphs. Answer their actual question directly and practically. You may note chapters like (Ch 2). Use plain text, no markdown headers or asterisks.`;

  const msgs = [{ role: "system", content: system },
    { role: "user", content: `MY PROFILE: ${person}\n\n${learned.length ? `WHAT YOU'VE LEARNED ABOUT ME SO FAR (use it, stay consistent):\n${learned.map(l => "- " + l).join("\n")}\n\n` : ""}${log ? `MY RECENT DAILY LOG (newest first): ${log}\n\n` : ""}${topic && topic.problem ? `I CAME HERE TO ASK ABOUT THIS SPECIFIC TOPIC: "${String(topic.problem).slice(0,120)}"${topic.chapter ? ` (Ch ${String(topic.chapter).slice(0,6)})` : ""}.\nWhat the book says on it: ${String(topic.guidance || "").slice(0, 900)}\nKeep your answers focused on this topic unless I clearly change the subject.\n\n` : ""}BOOK PRINCIPLES: ${BOOK.principles}\n\nRELEVANT BOOK GUIDANCE FOR THIS QUESTION:\n${relText}\n\n(You now have my context, including how my actual days have been going. Answer my messages that follow using all of this, speaking to my real pattern.)` },
    { role: "assistant", content: "Understood — I have your profile and the book in mind. Ask me anything." }];
  for (const h of history) if (h && h.role && h.content) msgs.push({ role: h.role === "user" ? "user" : "assistant", content: String(h.content).slice(0, 1500) });
  msgs.push({ role: "user", content: message });

  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json",
                 "HTTP-Referer": "https://ayurveda-remedies-two.vercel.app", "X-Title": "Ayurveda Remedies" },
      body: JSON.stringify({ model: "minimax/minimax-m3", temperature: 0.6, max_tokens: 900, messages: msgs }),
    });
    if (!r.ok) { const t = await r.text(); res.status(502).json({ error: "llm " + r.status, detail: t.slice(0, 160) }); return; }
    const data = await r.json();
    let reply = data?.choices?.[0]?.message?.content?.trim() || "";
    const scan = (message + " " + (i.problems || "") + " " + (i.mental || "")).toLowerCase();
    const serious = /depress|anxiet|suicid|self.?harm|medicat|medicine|pills|pregnan|chest pain|bleeding|cancer|tumou?r|\bstroke\b|diabet|blood pressure|\bchild\b|\bson\b|\bdaughter\b|\bbaby\b/i;
    if (serious.test(scan)) reply += "\n\n(Note: for anything involving mental health, medication, pregnancy, a child, or a serious symptom, please see a qualified professional — this is supportive guidance only, and never stop prescribed medicine on your own.)";
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ reply });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};
