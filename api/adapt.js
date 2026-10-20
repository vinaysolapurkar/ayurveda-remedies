// Vercel serverless: generate TOMORROW's personalised daily routine,
// adapted from the person's dosha + recent daily log + recent chat,
// grounded in the Ashtanga Hridaya. Returns {reason, items:[{time,title,why}]}.
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
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 22).map(x => x.r);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) { res.status(500).json({ error: "LLM not configured" }); return; }
  let body = req.body;
  try { if (typeof body === "string") body = JSON.parse(body); } catch { body = {}; }
  const profile = (body && body.profile) || {};
  if (!profile.dosha) { res.status(400).json({ error: "missing profile" }); return; }
  const log = (body && body.log || "").toString().slice(0, 1600);
  const chat = Array.isArray(body && body.history)
    ? body.history.slice(-6).map(h => `${h.role === "user" ? "Me" : "Guide"}: ${String(h.content).slice(0, 300)}`).join("\n")
    : "";

  const i = profile.intake || {};
  const rel = pick(profile, log + " " + chat);
  const relText = rel.map(r => `- [${r.category}] ${r.problem}: ${r.guidance} (Ch ${r.chapter})`).join("\n");
  const person = `Dosha: ${profile.doshaName || "?"}${profile.second ? " + " + profile.second : ""}. Wake ${i.wake || "?"}, sleep ${i.sleep || "?"}, meals ${i.meals || "?"} (${i.regular || "?"}). Exercise: ${i.exercise || "?"}. Problems: ${i.problems || "?"}.`;

  const system = `You design a person's daily Ayurvedic routine (dinacharya) for TOMORROW, grounded ONLY in the Ashtanga Hridaya material provided. Do not invent herbs, medicines or remedies beyond it. This is lifestyle guidance, not medical advice. Never tell anyone to stop prescribed medicine. Keep every item a simple, doable daily action.

You are given the person's base routine needs, their recent day-by-day log, and recent chat. ADAPT tomorrow's routine to reality:
- If they keep MISSING a habit, make that item SMALLER and easier, or move it to an easier time, so they can actually do it (e.g. "5 min walk" instead of "20 min"). Build the habit, don't scold.
- If they did something WELL, keep it and gently progress it.
- Put the habit they most need to fix near the top.
- Keep it to 5 to 8 items. Ground each in the book and name the chapter in "why".`;

  const user = `PRINCIPLES:\n${BOOK.principles}\n\nRELEVANT BOOK GUIDANCE:\n${relText}\n\nTHE PERSON:\n${person}\n\nTHEIR RECENT DAILY LOG (newest first):\n${log || "(no log yet)"}\n\nRECENT CHAT:\n${chat || "(none)"}\n\nReturn ONLY valid JSON, no prose, in exactly this shape:\n{"reason":"one short line on what you changed for tomorrow and why","items":[{"time":"Morning","title":"short action","why":"one sentence grounded in the book (Ch N)"}]}`;

  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json",
                 "HTTP-Referer": "https://ayurveda-remedies-two.vercel.app", "X-Title": "Ayurveda Remedies" },
      body: JSON.stringify({ model: "minimax/minimax-m3", temperature: 0.5, max_tokens: 1100,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!r.ok) { const t = await r.text(); res.status(502).json({ error: "llm " + r.status, detail: t.slice(0, 160) }); return; }
    const data = await r.json();
    let raw = data?.choices?.[0]?.message?.content?.trim() || "{}";
    // strip code fences / stray text, grab the JSON object
    const m = raw.match(/\{[\s\S]*\}/); if (m) raw = m[0];
    let parsed; try { parsed = JSON.parse(raw); } catch { parsed = null; }
    if (!parsed || !Array.isArray(parsed.items) || !parsed.items.length) {
      res.status(502).json({ error: "bad shape" }); return;
    }
    const items = parsed.items.slice(0, 8).map((it, ix) => ({
      id: "a" + ix,
      time: String(it.time || "").slice(0, 24) || "Today",
      title: String(it.title || "").slice(0, 90),
      why: String(it.why || "").slice(0, 260),
    })).filter(it => it.title);
    const reason = String(parsed.reason || "Adjusted from your recent days.").slice(0, 200);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ reason, items });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};
