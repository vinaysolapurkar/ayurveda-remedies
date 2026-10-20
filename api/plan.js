// Vercel serverless function: personalised Ayurvedic lifestyle plan.
// Feeds the user's dosha + lifestyle + stated problems, plus matching guidance
// from the Ashtanga Hridaya, to MiniMax (via OpenRouter) with strong safety rules.
const BOOK = require("../book.js");

function pick(profile) {
  const d = (profile && profile.dosha) || "";
  const txt = [profile?.intake?.problems, profile?.intake?.mental, profile?.intake?.physical,
               profile?.intake?.likes, profile?.intake?.dislikes].join(" ").toLowerCase();
  const words = txt.split(/[^a-z]+/).filter(w => w.length > 3);
  const lifestyleCats = new Set(["Daily Routine","Diet & Food","Digestion","Dosha Balance","Sleep","Energy","Seasonal","Prevention","Drinks","General"]);
  const scored = BOOK.remedies.map(r => {
    let s = 0;
    if (d && (r.dosha || "").includes(d === "V" ? "Vata" : d === "P" ? "Pitta" : "Kapha")) s += 3;
    if (lifestyleCats.has(r.category)) s += 1;
    const hay = (r.problem + " " + r.guidance).toLowerCase();
    for (const w of words) if (hay.includes(w)) s += 2;
    return { r, s };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 26).map(x => x.r);
  return scored;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) { res.status(500).json({ error: "LLM not configured" }); return; }
  let body = req.body;
  try { if (typeof body === "string") body = JSON.parse(body); } catch { body = {}; }
  const profile = body && body.profile;
  if (!profile) { res.status(400).json({ error: "missing profile" }); return; }

  const rel = pick(profile);
  const relText = rel.map(r => `- [${r.category}${r.dosha && r.dosha !== "—" ? ", " + r.dosha : ""}] ${r.problem}: ${r.guidance} (Ch ${r.chapter})`).join("\n");
  const i = profile.intake || {};
  const person = [
    `Dominant dosha (from quiz): ${profile.doshaName || "?"}${profile.second ? " with some " + profile.second : ""}.`,
    `Wake time: ${i.wake || "?"}. Sleep time: ${i.sleep || "?"}. Meal times: ${i.meals || "?"} (regularity: ${i.regular || "?"}).`,
    `Exercise: ${i.exercise || "?"}. Mental state: ${i.mental || "?"}. Physical state: ${i.physical || "?"}.`,
    `Enjoys: ${i.likes || "?"}. Avoids: ${i.dislikes || "?"}.`,
    `Their problems, in their own words: ${i.problems || "(none given)"}`,
  ].join("\n");

  const system = `You are a warm, practical Ayurvedic lifestyle guide. You give everyday wellbeing guidance grounded ONLY in the classical Ashtanga Hridaya material provided to you — do not invent herbs, medicines, dosages or remedies beyond it, and do not name branded products.

SAFETY — follow strictly:
- This is educational lifestyle guidance, NOT medical advice, diagnosis or treatment. Say so.
- If the person mentions depression, anxiety, any mental-health condition, stopping or being on medication, a serious or worsening illness, pregnancy, or a child's health: gently and clearly urge them to see a qualified doctor or mental-health professional / registered Ayurvedic practitioner, and NEVER suggest stopping or changing prescribed medicine. Frame Ayurveda only as supportive lifestyle alongside professional care.
- Be kind and non-judgemental. Never promise cures.

STYLE: Reply in the same language the person used for their problems. Warm, simple, encouraging, concrete. Speak directly to them ("you"). Use short plain sentences and a clear step-by-step structure. Where a point comes from the book, you may note the chapter like (Ch 2). Keep it focused and genuinely usable, not generic.`;

  const user = `PRINCIPLES FROM THE BOOK:\n${BOOK.principles}\n\nRELEVANT GUIDANCE FROM THE BOOK (matched to this person):\n${relText}\n\nTHE PERSON:\n${person}\n\nWrite their personal plan with these parts:\n1) A short, warm reflection on what is likely happening for them in simple Ayurvedic terms (dosha + digestion/Agni + routine), tied to what they told you.\n2) A gentle daily rhythm for them (wake, movement, meals at good times, wind-down) fitted to their real schedule and dosha.\n3) Food and simple habits to favour and to reduce, for their dosha and problems.\n4) 2–4 small, doable first steps for THIS week, addressing each problem they named.\n5) A clear line on when to see a professional.\nEnd with one encouraging sentence. Do not use markdown headers or asterisks; use plain text with line breaks and simple numbering.`;

  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json",
                 "HTTP-Referer": "https://ayurveda-remedies-two.vercel.app", "X-Title": "Ayurveda Remedies" },
      body: JSON.stringify({ model: "minimax/minimax-m3", temperature: 0.6, max_tokens: 1300,
        messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!r.ok) { const t = await r.text(); res.status(502).json({ error: "llm " + r.status, detail: t.slice(0, 200) }); return; }
    const data = await r.json();
    let plan = data?.choices?.[0]?.message?.content?.trim() || "";
    // deterministic safety layer — do not rely on the model alone
    const uinput = [i.problems, i.mental, i.physical].join(" ").toLowerCase();
    const serious = /depress|anxiet|suicid|self.?harm|medicat|medicine|pills|pregnan|chest pain|breath|bleeding|cancer|tumou?r|heart|stroke|diabet|blood pressure|\bchild\b|\bkid\b|\bson\b|\bdaughter\b|\bbaby\b/i;
    const banner = serious.test(uinput)
      ? "IMPORTANT — please read first. Some of what you described (such as mental health, being on or off medication, pregnancy, a child, or a serious symptom) needs a qualified professional. Please speak with a doctor or mental-health professional, or a registered Ayurvedic practitioner. The guidance below is only gentle lifestyle support alongside professional care — it is not a treatment or a diagnosis, and you should never stop or change prescribed medicine on your own.\n\n— — —\n\n"
      : "";
    const footer = "\n\n— — —\nRemember: this is traditional Ayurvedic guidance for everyday wellbeing, not medical advice. For anything serious, ongoing, or involving medication, pregnancy or a child, please see a qualified practitioner.";
    plan = banner + plan + footer;
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ plan });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};
