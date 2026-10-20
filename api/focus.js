// Vercel serverless: pick the SINGLE next small change for the coming week.
// One tiny, concrete habit at a time — chosen from the person's dosha, their
// recent daily log, their chat (they may have hinted what they're ready for),
// and what they have already mastered. Grounded in the Ashtanga Hridaya.
const BOOK = require("../book.js");

function pick(profile, extra) {
  const d = (profile && profile.dosha) || "";
  const i = (profile && profile.intake) || {};
  const txt = [i.problems, i.mental, i.physical, i.exercise, extra].join(" ").toLowerCase();
  const words = txt.split(/[^a-z]+/).filter(w => w.length > 3);
  const life = new Set(["Daily Routine","Diet & Food","Digestion","Dosha Balance","Sleep","Energy","Seasonal","Prevention","Drinks","General"]);
  return BOOK.remedies.map(r => {
    let s = 0;
    if (d && (r.dosha || "").includes(d === "V" ? "Vata" : d === "P" ? "Pitta" : "Kapha")) s += 3;
    if (life.has(r.category)) s += 1;
    const hay = (r.problem + " " + r.guidance).toLowerCase();
    for (const w of words) if (hay.includes(w)) s += 2;
    return { r, s };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 20).map(x => x.r);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) { res.status(500).json({ error: "LLM not configured" }); return; }
  let body = req.body;
  try { if (typeof body === "string") body = JSON.parse(body); } catch { body = {}; }
  const profile = (body && body.profile) || {};
  if (!profile.dosha) { res.status(400).json({ error: "missing profile" }); return; }
  const log = (body && body.log || "").toString().slice(0, 1400);
  const mastered = Array.isArray(body && body.mastered) ? body.mastered.slice(-12).map(m => String(m).slice(0, 90)) : [];
  const chat = Array.isArray(body && body.history)
    ? body.history.slice(-8).map(h => `${h.role === "user" ? "Me" : "Guide"}: ${String(h.content).slice(0, 320)}`).join("\n")
    : "";

  const i = profile.intake || {};
  const rel = pick(profile, log + " " + chat);
  const relText = rel.map(r => `- [${r.category}] ${r.problem}: ${r.guidance} (Ch ${r.chapter})`).join("\n");
  const person = `Dosha: ${profile.doshaName || "?"}${profile.second ? " + " + profile.second : ""}. Wake ${i.wake || "?"}, sleep ${i.sleep || "?"}, meals ${i.meals || "?"} (${i.regular || "?"}). Exercise: ${i.exercise || "?"}. Problems: ${i.problems || "?"}.`;

  const system = `You are a gentle Ayurvedic habit coach grounded ONLY in the Ashtanga Hridaya material provided. This is lifestyle guidance, not medical advice; never tell anyone to stop prescribed medicine; never promise cures.

Your whole job: choose the ONE single small change this person should focus on for the coming week — nothing more. People change one habit at a time. Rules:
- Pick ONE concrete, tiny, specific action (e.g. "Eat dinner by 9pm instead of 10pm", "Add a 5-minute morning walk", "Warm water on waking"). Not a routine, not a list.
- If their chat shows they ALREADY sense what they want to change (e.g. they mentioned moving dinner from 10 to 9), choose exactly that — meet them where they are.
- Build on what they have already mastered; do NOT repeat a mastered habit. Make the next step small and natural after those.
- Make it easy enough that a tired, busy person can actually do it every day.
- Ground it in the book and name the chapter.`;

  const user = `PRINCIPLES:\n${BOOK.principles}\n\nRELEVANT BOOK GUIDANCE:\n${relText}\n\nTHE PERSON:\n${person}\n\nTHEIR RECENT DAILY LOG (newest first):\n${log || "(no log yet)"}\n\nRECENT CHAT:\n${chat || "(none)"}\n\nHABITS THEY HAVE ALREADY MASTERED (do not repeat):\n${mastered.length ? mastered.map(m => "- " + m).join("\n") : "(none yet — this is their first change)"}\n\nReturn ONLY valid JSON, no prose:\n{"text":"the one small change as a short imperative (max ~8 words)","why":"one warm sentence, why it helps, grounded in the book","chapter":"the chapter number as a string"}`;

  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json",
                 "HTTP-Referer": "https://ayurveda-remedies-two.vercel.app", "X-Title": "Ayurveda Remedies" },
      body: JSON.stringify({ model: "minimax/minimax-m3", temperature: 0.5, max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!r.ok) { const t = await r.text(); res.status(502).json({ error: "llm " + r.status, detail: t.slice(0, 160) }); return; }
    const data = await r.json();
    let raw = data?.choices?.[0]?.message?.content?.trim() || "{}";
    const m = raw.match(/\{[\s\S]*\}/); if (m) raw = m[0];
    let p; try { p = JSON.parse(raw); } catch { p = null; }
    if (!p || !p.text) { res.status(502).json({ error: "bad shape" }); return; }
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      text: String(p.text).slice(0, 90),
      why: String(p.why || "").slice(0, 260),
      chapter: String(p.chapter || "").slice(0, 8),
    });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};
